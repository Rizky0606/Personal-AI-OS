import type { AgentEvent } from '@aios/contracts';
import { summarize } from '../events.js';
import { AsyncQueue } from '../queue.js';
import {
  AdapterError,
  type AdapterCapabilities,
  type AgentAdapter,
  type RunHandle,
  type StartRunInput,
} from '../types.js';
import { uuidv7 } from '../uuidv7.js';
import { AcpConnection, AcpRpcError, isRecord, type AcpTransport } from './rpc.js';

export interface AcpLaunch {
  runId: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface AcpAdapterOptions {
  id: AgentAdapter['id'];
  /** Meluncurkan proses agent (stdio). Pembatasan proses (pengguna, memori, waktu) ada di peluncur. */
  launch: (spec: AcpLaunch) => AcpTransport | Promise<AcpTransport>;
  args?: string[];
  env?: Record<string, string>;
  /** Batas `initialize`, `session/new`, `session/set_config_option`. */
  startupTimeoutMs?: number;
  /** Tanpa frame dari agent selama ini (di luar menunggu izin) dianggap macet. */
  idleTimeoutMs?: number;
  /** Batas total satu run; 0 = tanpa batas. */
  maxRunMs?: number;
  /** Izin yang tidak dijawab pengguna sampai batas ini ditolak otomatis. */
  approvalTimeoutMs?: number;
  /** Waktu menunggu agent menutup giliran setelah `session/cancel` sebelum proses dimatikan. */
  abortGraceMs?: number;
  /** Event/frame yang tidak dikenal: diabaikan, dilaporkan ke sini untuk log. */
  onUnknown?: (kind: string, raw: unknown) => void;
  now?: () => number;
  newId?: () => string;
}

const CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  approvals: true,
  steer: false,
  checkpoints: false,
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

type ApprovalKind = 'command' | 'file_write' | 'network';

function approvalKind(kind: string | undefined): ApprovalKind {
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'file_write';
  if (kind === 'fetch') return 'network';
  return 'command';
}

function targetOf(raw: unknown, locations: unknown): string | undefined {
  if (isRecord(raw)) {
    const value =
      str(raw.command) ??
      str(raw.path) ??
      str(raw.file_path) ??
      str(raw.filePath) ??
      str(raw.url) ??
      str(raw.pattern) ??
      str(raw.query);
    if (value) return clip(value, 500);
  }
  if (Array.isArray(locations) && isRecord(locations[0])) {
    const path = str(locations[0].path);
    if (path) return clip(path, 500);
  }
  return undefined;
}

/** Teks dari `content` ToolCall: `[{type:'content', content:{type:'text', text}}]`. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((item) => {
      if (!isRecord(item) || item.type !== 'content' || !isRecord(item.content)) return [];
      return item.content.type === 'text' ? [str(item.content.text) ?? ''] : [];
    })
    .join('');
}

interface PermissionOption {
  optionId: string;
  kind: string;
}

function parseOptions(raw: unknown): PermissionOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) =>
    isRecord(o) && typeof o.optionId === 'string' && typeof o.kind === 'string'
      ? [{ optionId: o.optionId, kind: o.kind }]
      : [],
  );
}

/** Opsi menurut `kind` (bukan teks). `undefined` = tidak ada opsi yang cocok. */
export function pickPermissionOption(
  options: readonly PermissionOption[],
  decision: 'allow' | 'deny',
  remember: boolean,
): { optionId: string; remembered: boolean } | undefined {
  const prefix = decision === 'allow' ? 'allow' : 'reject';
  const once = options.find((o) => o.kind === `${prefix}_once`);
  const always = options.find((o) => o.kind === `${prefix}_always`);
  if (remember && always) return { optionId: always.optionId, remembered: true };
  if (once) return { optionId: once.optionId, remembered: false };
  if (always) return { optionId: always.optionId, remembered: true };
  return undefined;
}

type Outcome = { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };

interface PendingApproval {
  options: PermissionOption[];
  toolCallId: string | undefined;
  settle: (outcome: Outcome) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface ToolState {
  name: string;
  startedAt: number;
  text: string;
}

const STOP_ERRORS: Record<string, string> = {
  max_tokens: 'Model berhenti karena batas token.',
  max_turn_requests: 'Agent berhenti karena batas jumlah langkah.',
  refusal: 'Model menolak permintaan.',
};

/**
 * Adapter ACP generik (docs/ADAPTER_ACP.md): satu proses agent per run, satu sesi, satu prompt.
 * Proses mati, macet, atau waktu habis berakhir pada event `error` lalu stream selesai.
 */
export function createAcpAdapter(options: AcpAdapterOptions): AgentAdapter {
  const deps = { now: options.now ?? Date.now, newId: options.newId ?? uuidv7, options };
  return {
    id: options.id,
    capabilities: () => CAPABILITIES,
    async startRun(input: StartRunInput): Promise<RunHandle> {
      if (!input.cwd?.trim()) {
        throw new AdapterError('acp_config', 'cwd wajib untuk menjalankan agent ACP.');
      }
      const transport = await options.launch({
        runId: input.runId,
        args: options.args ?? [],
        cwd: input.cwd,
        env: options.env ?? {},
      });
      return new AcpRun(input, transport, deps).start();
    },
  };
}

class AcpRun implements RunHandle {
  readonly runId: string;
  readonly events = new AsyncQueue<AgentEvent>();
  private readonly conn: AcpConnection;
  private readonly tools = new Map<string, ToolState>();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly deniedTools = new Set<string>();
  private text = '';
  private sessionId: string | undefined;
  private canClose = false;
  private finished = false;
  private cancelRequested = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private runTimer: ReturnType<typeof setTimeout> | undefined;
  private onFinish: () => void = () => undefined;
  private readonly settled = new Promise<void>((resolve) => (this.onFinish = resolve));

  constructor(
    private readonly input: StartRunInput,
    private readonly transport: AcpTransport,
    private readonly deps: {
      now: () => number;
      newId: () => string;
      options: AcpAdapterOptions;
    },
  ) {
    this.runId = input.runId;
    this.conn = new AcpConnection(transport, {
      onNotification: (method, params) => this.onNotification(method, params),
      onRequest: (method, params) => this.onRequest(method, params),
      onInvalid: (line) => this.deps.options.onUnknown?.('invalid_line', clip(line, 200)),
      onClose: () => this.onClose(),
    });
  }

  start(): RunHandle {
    this.touch();
    const max = this.deps.options.maxRunMs ?? 0;
    if (max > 0) {
      this.runTimer = setTimeout(
        () => this.fail('acp_run_timeout', 'Run melewati batas waktu maksimum.', false),
        max,
      );
    }
    this.input.signal?.addEventListener('abort', () => void this.cancel(), { once: true });
    void this.run();
    return this;
  }

  private emit(event: AgentEvent): void {
    if (!this.finished) this.events.push(event);
  }

  /** Setiap frame dari agent memperpanjang batas macet; selama menunggu izin pengguna batas dihentikan. */
  private touch(): void {
    clearTimeout(this.idleTimer);
    if (this.finished || this.pending.size > 0) return;
    this.idleTimer = setTimeout(
      () => this.fail('acp_timeout', 'Agent tidak mengirim apa pun dalam batas waktu.', true),
      this.deps.options.idleTimeoutMs ?? 600_000,
    );
  }

  private async run(): Promise<void> {
    const startup = this.deps.options.startupTimeoutMs ?? 30_000;
    try {
      const init = await this.conn.request(
        'initialize',
        {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'personal-ai-os', version: '0.0.0' },
        },
        startup,
      );
      if (this.stopped()) return;
      const caps = isRecord(init) ? init : {};
      const agentCaps = isRecord(caps.agentCapabilities) ? caps.agentCapabilities : {};
      const prompt = isRecord(agentCaps.promptCapabilities) ? agentCaps.promptCapabilities : {};
      const mcp = isRecord(agentCaps.mcpCapabilities) ? agentCaps.mcpCapabilities : {};
      const session = isRecord(agentCaps.sessionCapabilities) ? agentCaps.sessionCapabilities : {};
      this.canClose = session.close !== undefined && session.close !== null;

      const methods = Array.isArray(caps.authMethods) ? caps.authMethods : [];
      const method = methods.find(isRecord);
      if (method && typeof method.id === 'string') {
        await this.conn.request('authenticate', { methodId: method.id }, startup);
        if (this.stopped()) return;
      }

      const mcpServers =
        mcp.http === true && this.input.mcpServers
          ? Object.entries(this.input.mcpServers).map(([name, s]) => ({
              type: 'http',
              name,
              url: s.url,
              headers: Object.entries(s.headers ?? {}).map(([k, v]) => ({ name: k, value: v })),
            }))
          : [];
      const created = await this.conn.request(
        'session/new',
        { cwd: this.input.cwd, mcpServers },
        startup,
      );
      if (this.stopped()) return;
      const sessionId = isRecord(created) ? str(created.sessionId) : undefined;
      if (!sessionId) {
        this.fail('acp_protocol', 'Agent tidak mengembalikan sessionId.', false);
        return;
      }
      this.sessionId = sessionId;

      if (this.input.model) {
        try {
          await this.conn.request(
            'session/set_config_option',
            { sessionId, configId: 'model', value: this.input.model },
            startup,
          );
        } catch (err) {
          if (err instanceof AcpRpcError) {
            this.fail('acp_model_unavailable', `Agent menolak model ${this.input.model}.`, false);
            return;
          }
          throw err;
        }
        if (this.stopped()) return;
      }

      const blocks: Record<string, unknown>[] = [
        { type: 'text', text: this.promptText() },
        ...(prompt.image === true
          ? (this.input.images ?? []).map((img) => ({
              type: 'image',
              mimeType: img.mime,
              data: img.data,
            }))
          : []),
      ];
      const result = await this.conn.request('session/prompt', { sessionId, prompt: blocks });
      this.onPromptResult(result);
    } catch (err) {
      if (this.finished) return;
      if (this.cancelRequested) {
        this.finish();
      } else if (err instanceof AcpRpcError) {
        const code = err.code === -32000 ? 'acp_auth_required' : `acp_rpc_${err.code}`;
        this.fail(code, clip(err.message.split('\n')[0] ?? 'Agent gagal.', 300), false);
      } else if (err instanceof AdapterError) {
        this.fail(err.code, err.message, err.retryable);
      } else {
        this.fail('adapter_failure', 'Mesin agent gagal dengan kesalahan tak terduga.', false);
      }
    }
  }

  private stopped(): boolean {
    return this.finished || this.cancelRequested;
  }

  /** ACP tidak punya pesan sistem: role dan riwayat digabung ke teks prompt. */
  private promptText(): string {
    const parts: string[] = [];
    if (this.input.systemPrompt?.trim()) parts.push(this.input.systemPrompt.trim());
    if (this.input.history?.length) {
      parts.push(
        '# Riwayat percakapan\n' +
          this.input.history
            .map((m) => `${m.role === 'user' ? 'Pengguna' : 'Asisten'}: ${m.content}`)
            .join('\n\n'),
      );
    }
    parts.push(this.input.prompt);
    return parts.join('\n\n---\n\n');
  }

  private onClose(): void {
    if (this.finished) return;
    if (this.cancelRequested) this.finish();
    else this.fail('acp_exited', 'Proses agent berhenti tiba-tiba.', true);
  }

  private onNotification(method: string, params: unknown): void {
    this.touch();
    if (method !== 'session/update') {
      this.deps.options.onUnknown?.(`notification:${method}`, params);
      return;
    }
    if (!isRecord(params) || !isRecord(params.update)) return;
    if (this.sessionId && params.sessionId !== this.sessionId) return;
    const update = params.update;
    const kind = str(update.sessionUpdate) ?? '';
    switch (kind) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const content = update.content;
        if (!isRecord(content) || content.type !== 'text' || typeof content.text !== 'string') {
          this.deps.options.onUnknown?.(`${kind}:non_text`, update);
          return;
        }
        if (content.text === '') return;
        if (kind === 'agent_message_chunk') {
          this.text += content.text;
          this.emit({ type: 'message.delta', messageId: this.input.messageId, text: content.text });
        } else {
          this.emit({
            type: 'reasoning.delta',
            messageId: this.input.messageId,
            text: content.text,
          });
        }
        return;
      }
      case 'tool_call':
      case 'tool_call_update':
        this.onTool(update);
        return;
      case 'usage_update':
      case 'config_option_update':
      case 'session_info_update':
      case 'available_commands_update':
      case 'current_mode_update':
      case 'user_message_chunk':
        return; // diketahui, tidak ada padanan di kontrak
      default:
        this.deps.options.onUnknown?.(`session_update:${kind}`, update);
    }
  }

  private onTool(update: Record<string, unknown>): void {
    const id = str(update.toolCallId);
    if (!id) return;
    let tool = this.tools.get(id);
    if (!tool) {
      const name = str(update.name) ?? str(update.kind) ?? str(update.title) ?? 'tool';
      tool = { name: clip(name, 200), startedAt: this.deps.now(), text: '' };
      this.tools.set(id, tool);
      const target = targetOf(update.rawInput, update.locations);
      this.emit({
        type: 'tool.started',
        toolCallId: id,
        name: tool.name,
        ...(target ? { target } : {}),
      });
    }
    const full = contentText(update.content);
    if (full) {
      // Teks kumulatif: yang dikirim hanya tambahan barunya.
      const chunk = full.startsWith(tool.text) ? full.slice(tool.text.length) : full;
      tool.text = full;
      if (chunk) {
        this.emit({
          type: 'tool.output',
          toolCallId: id,
          chunk: clip(chunk, 8000),
          stream: 'stdout',
        });
      }
    }
    const status = update.status;
    if (status === 'completed' || status === 'failed') {
      this.tools.delete(id);
      const denied = this.deniedTools.delete(id);
      this.emit({
        type: 'tool.finished',
        toolCallId: id,
        status: this.cancelRequested
          ? 'cancelled'
          : denied
            ? 'denied'
            : status === 'failed'
              ? 'error'
              : 'ok',
        durationMs: Math.max(0, this.deps.now() - tool.startedAt),
      });
    }
  }

  private onRequest(method: string, params: unknown): Promise<unknown> {
    this.touch();
    if (method === 'session/request_permission') return this.onPermission(params);
    this.deps.options.onUnknown?.(`request:${method}`, params);
    return Promise.reject(new AcpRpcError(-32601, 'Method not found'));
  }

  private onPermission(params: unknown): Promise<unknown> {
    if (!isRecord(params)) return Promise.reject(new AcpRpcError(-32602, 'Invalid params'));
    const options = parseOptions(params.options);
    const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
    const toolCallId = str(toolCall.toolCallId);
    if (this.cancelRequested || this.finished) {
      return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    }
    const approvalId = this.deps.newId();
    const title = str(toolCall.title) ?? '';
    const target = targetOf(toolCall.rawInput, toolCall.locations);
    const detail = clip(
      [title, target && target !== title ? target : ''].filter(Boolean).join('\n') ||
        'Izin diminta agent',
      4000,
    );
    return new Promise((resolve) => {
      const entry: PendingApproval = {
        options,
        toolCallId,
        timer: undefined,
        settle: (outcome) => {
          clearTimeout(entry.timer);
          this.pending.delete(approvalId);
          this.touch();
          resolve({ outcome });
        },
      };
      const ms = this.deps.options.approvalTimeoutMs ?? 600_000;
      if (ms > 0) entry.timer = setTimeout(() => this.expire(approvalId), ms);
      this.pending.set(approvalId, entry);
      clearTimeout(this.idleTimer);
      const known = toolCallId !== undefined && this.tools.has(toolCallId);
      this.emit({
        type: 'approval.requested',
        approvalId,
        kind: approvalKind(str(toolCall.kind)),
        detail,
        ...(this.input.cwd ? { cwd: this.input.cwd } : {}),
        ...(known ? { toolCallId } : {}),
      });
    });
  }

  /** Tolak otomatis: `reject_once` bila ada, kalau tidak `cancelled`. */
  private expire(approvalId: string): void {
    const entry = this.pending.get(approvalId);
    if (!entry) return;
    this.settleDeny(approvalId, entry);
  }

  private settleDeny(approvalId: string, entry: PendingApproval): void {
    const chosen = pickPermissionOption(entry.options, 'deny', false);
    if (entry.toolCallId) this.deniedTools.add(entry.toolCallId);
    entry.settle(
      chosen ? { outcome: 'selected', optionId: chosen.optionId } : { outcome: 'cancelled' },
    );
    this.emit({ type: 'approval.resolved', approvalId, decision: 'deny', remember: false });
  }

  private onPromptResult(result: unknown): void {
    const stop = isRecord(result) ? str(result.stopReason) : undefined;
    this.closeOpenTools();
    if (stop === 'end_turn') {
      this.emit({ type: 'message.completed', messageId: this.input.messageId });
      this.emit({ type: 'run.completed', summary: summarize(this.text) });
    } else if (stop === 'cancelled') {
      // Dibatalkan lewat cancel(): tanpa event penutup. Pembatalan yang tidak diminta dianggap gagal.
      if (!this.cancelRequested) {
        this.emit({
          type: 'error',
          code: 'acp_cancelled',
          message: 'Agent menghentikan run sendiri.',
          retryable: true,
        });
      }
    } else if (stop && STOP_ERRORS[stop]) {
      this.emit({
        type: 'error',
        code: `acp_${stop}`,
        message: STOP_ERRORS[stop],
        retryable: false,
      });
    } else {
      this.deps.options.onUnknown?.('stop_reason', result);
      this.emit({
        type: 'error',
        code: 'acp_protocol',
        message: 'Agent mengakhiri giliran dengan alasan yang tidak dikenal.',
        retryable: false,
      });
    }
    this.finish();
  }

  /** `cancelled` bila run dibatalkan, selain itu `error`: tool tidak boleh tampak berjalan selamanya. */
  private closeOpenTools(): void {
    const status = this.cancelRequested ? 'cancelled' : 'error';
    for (const [toolCallId, tool] of this.tools) {
      this.emit({
        type: 'tool.finished',
        toolCallId,
        status,
        durationMs: Math.max(0, this.deps.now() - tool.startedAt),
      });
    }
    this.tools.clear();
  }

  private finish(): void {
    if (this.finished) return;
    this.closeOpenTools();
    this.finished = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.runTimer);
    for (const entry of [...this.pending.values()]) entry.settle({ outcome: 'cancelled' });
    this.events.end();
    this.onFinish();
    void this.shutdown();
  }

  /** Tutup sesi bila didukung, tutup stdin, lalu matikan proses bila tidak berhenti sendiri. */
  private async shutdown(): Promise<void> {
    const exited = this.transport.exited.then(() => true);
    if (this.sessionId && this.canClose && !this.conn.isClosed && !this.cancelRequested) {
      await this.conn
        .request('session/close', { sessionId: this.sessionId }, 1500)
        .catch(() => undefined);
    }
    this.conn.dispose();
    this.transport.closeInput();
    const timer = setTimeout(() => this.transport.kill(), 2000);
    await exited.catch(() => undefined);
    clearTimeout(timer);
  }

  private fail(code: string, message: string, retryable: boolean): void {
    if (this.finished) return;
    this.closeOpenTools();
    this.emit({ type: 'error', code, message, retryable });
    this.finish();
    // Macet atau salah protokol: jangan menunggu penutupan sopan.
    if (code === 'acp_timeout' || code === 'acp_run_timeout') this.transport.kill();
  }

  steer(): Promise<void> {
    return Promise.reject(
      new AdapterError('steer_unsupported', 'Engine ini tidak mendukung steer.'),
    );
  }

  async cancel(): Promise<void> {
    if (this.finished || this.cancelRequested) return;
    this.cancelRequested = true;
    // Sesuai ACP: izin yang menggantung dijawab `cancelled`; pengguna melihatnya sebagai ditolak.
    for (const [approvalId, entry] of [...this.pending]) {
      if (entry.toolCallId) this.deniedTools.add(entry.toolCallId);
      entry.settle({ outcome: 'cancelled' });
      this.emit({ type: 'approval.resolved', approvalId, decision: 'deny', remember: false });
    }
    if (!this.sessionId) {
      this.finish(); // belum ada sesi: tidak ada giliran yang perlu ditunggu
      return;
    }
    // Jawaban `cancelled` untuk izin harus keluar lebih dulu daripada `session/cancel`.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (this.finished) return;
    this.conn.notify('session/cancel', { sessionId: this.sessionId });
    const grace = this.deps.options.abortGraceMs ?? 5000;
    const timer = setTimeout(() => {
      this.transport.kill();
      this.finish();
    }, grace);
    await this.settled;
    clearTimeout(timer);
  }

  resolveApproval(approvalId: string, decision: 'allow' | 'deny', remember = false): Promise<void> {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      return Promise.reject(
        new AdapterError('approval_unknown', 'Permintaan izin tidak ditemukan.'),
      );
    }
    if (decision === 'deny') {
      const chosen = pickPermissionOption(entry.options, 'deny', remember);
      if (entry.toolCallId) this.deniedTools.add(entry.toolCallId);
      entry.settle(
        chosen ? { outcome: 'selected', optionId: chosen.optionId } : { outcome: 'cancelled' },
      );
      this.emit({
        type: 'approval.resolved',
        approvalId,
        decision: 'deny',
        remember: chosen?.remembered ?? false,
      });
      return Promise.resolve();
    }
    const chosen = pickPermissionOption(entry.options, 'allow', remember);
    if (!chosen) {
      return Promise.reject(
        new AdapterError(
          'approval_option_missing',
          'Agent tidak menyediakan opsi untuk keputusan ini.',
        ),
      );
    }
    entry.settle({ outcome: 'selected', optionId: chosen.optionId });
    this.emit({
      type: 'approval.resolved',
      approvalId,
      decision: 'allow',
      remember: chosen.remembered,
    });
    return Promise.resolve();
  }
}
