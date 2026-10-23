import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEvent, Usage } from '@aios/contracts';
import { summarize } from './events.js';
import { AsyncQueue } from './queue.js';
import {
  AdapterError,
  type AdapterCapabilities,
  type AgentAdapter,
  type RunHandle,
  type StartRunInput,
} from './types.js';
import { uuidv7 } from './uuidv7.js';

/** Satu proses omp: JSONL lewat stdin/stdout (docs/VERIFICATION.md, bagian omp). */
export interface OmpTransport {
  /** Mengirim satu frame; adapter menambah newline. */
  write(frame: string): void;
  /** Baris stdout, satu frame JSON per baris. Berakhir saat proses selesai. */
  lines: AsyncIterable<string>;
  /** Menutup stdin (shutdown bersih omp). */
  closeInput(): void;
  kill(): void;
  exited: Promise<{ code: number | null }>;
}

export interface OmpLaunch {
  runId: string;
  args: string[];
  cwd: string;
  /** Tambahan lingkungan (mis. PI_CODING_AGENT_DIR); peluncur menggabungkannya dengan lingkungan proses. */
  env: Record<string, string>;
}

export interface OmpAdapterOptions {
  launch: (spec: OmpLaunch) => OmpTransport | Promise<OmpTransport>;
  /** Titik akhir LLM yang dipakai omp: proxy lokal worker (menyisipkan token perangkat) dan kunci lokalnya. */
  llm: { baseUrl: string; apiKey: string };
  /** Waktu menunggu frame `ready` setelah proses dimulai. */
  readyTimeoutMs?: number;
  /** Waktu menunggu omp berhenti sendiri setelah `abort` sebelum proses dimatikan. */
  abortGraceMs?: number;
  now?: () => number;
  newId?: () => string;
}

/** Provider di `models.yml` per run; model dipilih sebagai `aios/<id>`. */
export const OMP_PROVIDER = 'aios';

const CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  approvals: true,
  steer: true,
  checkpoints: false,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Teks hasil tool dari `result.content` / `partialResult.content`. */
function contentText(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return '';
  return result.content
    .flatMap((part) => (isRecord(part) && part.type === 'text' ? [str(part.text) ?? ''] : []))
    .join('');
}

const APPROVAL_TITLE = /^Allow tool: (\S+)(?:\n([\s\S]*))?$/;

type ApprovalKind = 'command' | 'file_write' | 'network';

function approvalKind(tool: string): ApprovalKind {
  if (['write', 'edit', 'delete', 'rm', 'notebook', 'patch'].includes(tool)) return 'file_write';
  if (['fetch', 'web_search', 'browser', 'web'].includes(tool)) return 'network';
  return 'command';
}

/** `Command: x` menjadi `x` (perintah persis); detail lain dipertahankan apa adanya. */
function approvalDetail(tool: string, rest: string): string {
  const command = /^Command: ([\s\S]*)$/.exec(rest);
  // Tool MCP: nama tool ikut di baris pertama, karena argumennya saja tidak menjelaskan apa yang dipanggil.
  if (tool.startsWith('mcp__')) return clip(rest ? `${tool}\n${rest}` : tool, 4000);
  return clip(command ? (command[1] ?? '') : rest || tool, 4000);
}

function toolTarget(args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  const value =
    str(args.command) ??
    str(args.path) ??
    str(args.file_path) ??
    str(args.url) ??
    str(args.pattern) ??
    str(args.query);
  return value === undefined ? undefined : clip(value, 500);
}

interface PendingApproval {
  ompId: string;
  options: string[];
}

/** Opsi yang cocok untuk keputusan; teks opsi berasal dari request, tidak di-hard-code (VERIFICATION.md). */
export function pickOption(
  options: string[],
  decision: 'allow' | 'deny',
  remember: boolean,
): { value: string; remembered: boolean } | undefined {
  if (decision === 'deny') {
    const deny = options.find((o) => /^deny/i.test(o));
    return deny ? { value: deny, remembered: false } : undefined;
  }
  const session = options.find((o) => /^approve .+ for this session$/i.test(o));
  if (remember && session) return { value: session, remembered: true };
  const once =
    options.find((o) => /^approve$/i.test(o)) ??
    options.find((o) => /^approve/i.test(o) && o !== session);
  return once ? { value: once, remembered: false } : undefined;
}

/**
 * Adapter omp (`omp --mode rpc`). Berjalan di worker: cwd = worktree, approval selalu `always-ask`
 * (default omp adalah yolo), provider diarahkan ke proxy LLM lokal, dan role disuntik lewat
 * `--append-system-prompt <berkas>` di luar worktree, jadi tidak ada berkas yang ditulis ke repo kerja.
 */
export function createOmpAdapter(options: OmpAdapterOptions): AgentAdapter {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? uuidv7;

  return {
    id: 'omp',
    capabilities: () => CAPABILITIES,

    async startRun(input: StartRunInput): Promise<RunHandle> {
      const { cwd, runDir } = input;
      if (!cwd || !runDir) {
        throw new AdapterError('omp_config', 'cwd dan runDir wajib untuk menjalankan omp.');
      }
      const model = input.model ?? 'default';
      const agentDir = join(runDir, 'agent');
      const systemFile = join(runDir, 'system.md');
      const overlayFile = join(runDir, 'overlay.yml');
      await mkdir(agentDir, { recursive: true });
      await writeFile(join(agentDir, 'models.yml'), modelsYaml(options.llm, model));
      await writeFile(systemFile, input.systemPrompt ?? '');
      // Server MCP per run (tool browser worker) di direktori agent terisolasi, bukan di repo kerja.
      if (input.mcpServers && Object.keys(input.mcpServers).length > 0) {
        const servers = Object.fromEntries(
          Object.entries(input.mcpServers).map(([name, s]) => [
            name,
            { type: 'http', url: s.url, ...(s.headers ? { headers: s.headers } : {}) },
          ]),
        );
        await writeFile(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: servers }));
        // Tanpa ini omp menyembunyikan tool MCP di balik perangkat xd:// dan model tidak melihatnya langsung.
        await writeFile(overlayFile, 'tools:\n  xdev: false\n');
      }

      const transport = await options.launch({
        runId: input.runId,
        args: [
          '--mode',
          'rpc',
          // Default omp adalah yolo: tanpa ini, aturan approval SECURITY_OPS.md tidak berlaku.
          '--approval-mode',
          'always-ask',
          '--cwd',
          cwd,
          '--no-session',
          '--no-skills',
          '--no-extensions',
          '--no-lsp',
          '--no-title',
          '--append-system-prompt',
          systemFile,
          ...(input.mcpServers ? ['--config', overlayFile] : []),
          '--model',
          `${OMP_PROVIDER}/${model}`,
        ],
        cwd,
        env: {
          PI_CODING_AGENT_DIR: agentDir,
          // Server MCP lokal cepat; tunggu koneksinya selesai agar toolnya sudah ada di giliran pertama.
          ...(input.mcpServers ? { OMP_MCP_STARTUP_TIMEOUT_MS: '0' } : {}),
        },
      });

      return new OmpRun(input, transport, { now, newId, options }).start();
    },
  };
}

function modelsYaml(llm: { baseUrl: string; apiKey: string }, model: string): string {
  const q = (value: string) => JSON.stringify(value);
  return [
    'providers:',
    `  ${OMP_PROVIDER}:`,
    `    baseUrl: ${q(llm.baseUrl)}`,
    `    apiKey: ${q(llm.apiKey)}`,
    '    api: openai-completions',
    '    authHeader: true',
    '    models:',
    `      - id: ${q(model)}`,
    `        name: ${q(model)}`,
    '        reasoning: false',
    '        input: [text]',
    '        contextWindow: 128000',
    '        maxTokens: 8192',
    '',
  ].join('\n');
}

class OmpRun implements RunHandle {
  readonly runId: string;
  readonly events = new AsyncQueue<AgentEvent>();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly tools = new Map<string, { name: string; startedAt: number; text: string }>();
  private readonly usage: Usage = { inputTokens: 0, outputTokens: 0 };
  private text = '';
  private lastAssistantText = '';
  private finished = false;
  private cancelRequested = false;
  private promptSent = false;
  private seq = 0;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private promptFallback: ReturnType<typeof setTimeout> | undefined;
  private onFinish: () => void = () => undefined;
  private readonly settled = new Promise<void>((resolve) => (this.onFinish = resolve));

  constructor(
    private readonly input: StartRunInput,
    private readonly transport: OmpTransport,
    private readonly deps: {
      now: () => number;
      newId: () => string;
      options: OmpAdapterOptions;
    },
  ) {
    this.runId = input.runId;
  }

  start(): RunHandle {
    this.readyTimer = setTimeout(
      () => this.fail('omp_not_ready', 'omp tidak siap dalam batas waktu.', true),
      this.deps.options.readyTimeoutMs ?? 30_000,
    );
    void this.read();
    this.input.signal?.addEventListener('abort', () => void this.cancel(), { once: true });
    return this;
  }

  private send(frame: Record<string, unknown>): void {
    this.transport.write(`${JSON.stringify(frame)}\n`);
  }

  private emit(event: AgentEvent): void {
    if (!this.finished) this.events.push(event);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.readyTimer);
    clearTimeout(this.promptFallback);
    this.events.end();
    this.transport.closeInput();
    this.onFinish();
    // Beri omp kesempatan berhenti sendiri; bila tidak, matikan supaya tidak ada proses yatim.
    const timer = setTimeout(() => this.transport.kill(), 2000);
    void this.transport.exited.finally(() => clearTimeout(timer));
  }

  private fail(code: string, message: string, retryable = false): void {
    if (this.finished) return;
    this.emit({ type: 'error', code, message, retryable });
    this.finish();
  }

  private async read(): Promise<void> {
    try {
      for await (const line of this.transport.lines) {
        if (!line.trim()) continue;
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          continue; // omp hanya boleh mengirim JSON; baris lain diabaikan.
        }
        if (isRecord(frame)) this.handle(frame);
        if (this.finished) break;
      }
    } catch {
      // Pembaca gagal; ditangani sebagai proses berhenti di bawah.
    }
    if (!this.finished) {
      const exit = await this.transport.exited.catch(() => ({ code: null }));
      if (this.cancelRequested) this.finish();
      else this.fail('omp_exited', `omp berhenti tiba-tiba (kode ${String(exit.code)}).`, true);
    }
  }

  private handle(frame: Record<string, unknown>): void {
    switch (frame.type) {
      case 'ready':
        clearTimeout(this.readyTimer);
        // Percobaan ulang otomatis omp (hingga 10x ke LLM) dimatikan dulu; prompt baru dikirim setelah
        // pengaturan itu dikonfirmasi, kalau tidak galat model tetap diulang. Cadangan bila balasan tak datang.
        this.send({ id: 'cfg-retry', type: 'set_auto_retry', enabled: false });
        this.promptFallback = setTimeout(() => this.sendPrompt(), 3000);
        return;
      case 'response':
        if (frame.id === 'cfg-retry') this.sendPrompt();
        return;
      case 'message_update':
        this.onMessageUpdate(frame);
        return;
      case 'message_end':
        this.onMessageEnd(frame);
        return;
      case 'tool_execution_start':
        this.onToolStart(frame);
        return;
      case 'tool_execution_update':
        this.onToolUpdate(frame);
        return;
      case 'tool_execution_end':
        this.onToolEnd(frame);
        return;
      case 'extension_ui_request':
        this.onUiRequest(frame);
        return;
      case 'prompt_result':
        this.onPromptResult(frame);
        return;
      default:
        // available_commands_update, queue_update, agent_start, session_settled, response, dst.
        return;
    }
  }

  private sendPrompt(): void {
    if (this.promptSent || this.finished) return;
    this.promptSent = true;
    clearTimeout(this.promptFallback);
    this.send({ id: 'prompt', type: 'prompt', message: this.input.prompt });
  }

  private onMessageUpdate(frame: Record<string, unknown>): void {
    const update = frame.assistantMessageEvent;
    if (!isRecord(update)) return;
    const delta = str(update.delta);
    if (delta === undefined || delta === '') return;
    if (update.type === 'text_delta') {
      this.text += delta;
      this.emit({ type: 'message.delta', messageId: this.input.messageId, text: delta });
    } else if (update.type === 'thinking_delta') {
      this.emit({ type: 'reasoning.delta', messageId: this.input.messageId, text: delta });
    }
  }

  private onMessageEnd(frame: Record<string, unknown>): void {
    const message = frame.message;
    if (!isRecord(message) || message.role !== 'assistant') return;
    const usage = message.usage;
    if (isRecord(usage)) {
      const n = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.trunc(v) : 0);
      this.usage.inputTokens += n(usage.input);
      this.usage.outputTokens += n(usage.output);
      const cached = n(usage.cacheRead);
      if (cached) this.usage.cachedTokens = (this.usage.cachedTokens ?? 0) + cached;
    }
    if (Array.isArray(message.content)) {
      const turnText = contentText(message);
      if (turnText) this.lastAssistantText = turnText;
    }
  }

  private onToolStart(frame: Record<string, unknown>): void {
    const id = str(frame.toolCallId);
    const name = str(frame.toolName);
    if (!id || !name) return;
    this.tools.set(id, { name, startedAt: this.deps.now(), text: '' });
    const target = toolTarget(frame.args);
    this.emit({
      type: 'tool.started',
      toolCallId: id,
      name,
      ...(target ? { target } : {}),
    });
  }

  private onToolUpdate(frame: Record<string, unknown>): void {
    const id = str(frame.toolCallId);
    const tool = id ? this.tools.get(id) : undefined;
    if (!id || !tool) return;
    const full = contentText(frame.partialResult);
    // partialResult berisi teks kumulatif; yang dikirim hanya tambahan barunya.
    const chunk = full.startsWith(tool.text) ? full.slice(tool.text.length) : full;
    tool.text = full;
    if (chunk)
      this.emit({
        type: 'tool.output',
        toolCallId: id,
        chunk: clip(chunk, 8000),
        stream: 'stdout',
      });
  }

  private onToolEnd(frame: Record<string, unknown>): void {
    const id = str(frame.toolCallId);
    const tool = id ? this.tools.get(id) : undefined;
    if (!id || !tool) return;
    this.tools.delete(id);
    const result = contentText(frame.result);
    const denied = /^Tool call denied by user/i.test(result);
    const status = denied
      ? 'denied'
      : frame.isError === true
        ? 'error'
        : this.cancelRequested
          ? 'cancelled'
          : 'ok';
    this.emit({
      type: 'tool.finished',
      toolCallId: id,
      status,
      durationMs: Math.max(0, this.deps.now() - tool.startedAt),
    });
  }

  private onUiRequest(frame: Record<string, unknown>): void {
    if (frame.method !== 'select') return; // setWidget dan sejenisnya: fire-and-forget.
    const ompId = str(frame.id);
    const title = str(frame.title) ?? '';
    const options = Array.isArray(frame.options)
      ? frame.options.filter((o): o is string => typeof o === 'string')
      : [];
    const match = APPROVAL_TITLE.exec(title);
    if (!ompId || !match) return;
    const tool = match[1] ?? '';
    const approvalId = this.deps.newId();
    this.pending.set(approvalId, { ompId, options });
    const toolCallId = [...this.tools.entries()].reverse().find(([, t]) => t.name === tool)?.[0];
    this.emit({
      type: 'approval.requested',
      approvalId,
      kind: approvalKind(tool),
      detail: approvalDetail(tool, match[2] ?? ''),
      ...(this.input.cwd ? { cwd: this.input.cwd } : {}),
      ...(toolCallId ? { toolCallId } : {}),
    });
  }

  private onPromptResult(frame: Record<string, unknown>): void {
    const status = frame.status;
    if (status === 'completed') {
      const usage =
        this.usage.inputTokens || this.usage.outputTokens ? { ...this.usage } : undefined;
      this.emit({
        type: 'message.completed',
        messageId: this.input.messageId,
        ...(usage ? { usage } : {}),
      });
      this.emit({
        type: 'run.completed',
        summary: summarize(this.lastAssistantText || this.text),
        ...(usage ? { usage } : {}),
      });
    } else if (status === 'aborted') {
      // Dibatalkan lewat cancel(): tanpa event penutup. Abort yang tidak diminta dianggap gagal.
      if (!this.cancelRequested) {
        this.emit({
          type: 'error',
          code: 'omp_aborted',
          message: 'omp menghentikan run sendiri.',
          retryable: true,
        });
      }
    } else {
      const error = isRecord(frame.error) ? frame.error : {};
      const http = typeof error.httpStatus === 'number' ? error.httpStatus : undefined;
      const message = clip(
        (str(error.message) ?? 'Model gagal menjawab.').split('\n')[0] ?? '',
        300,
      );
      this.emit({
        type: 'error',
        code: http ? `model_http_${http}` : 'omp_error',
        message,
        retryable: error.retryable === true,
      });
    }
    this.finish();
  }

  steer(text: string): Promise<void> {
    if (this.finished) {
      return Promise.reject(new AdapterError('run_finished', 'Run sudah selesai.'));
    }
    this.send({ id: `steer-${++this.seq}`, type: 'steer', message: text });
    return Promise.resolve();
  }

  async cancel(): Promise<void> {
    if (this.finished || this.cancelRequested) return;
    this.cancelRequested = true;
    // Approval yang menggantung membuat tool menunggu selamanya; tolak dulu supaya abort bisa selesai.
    for (const approvalId of [...this.pending.keys()]) {
      await this.resolveApproval(approvalId, 'deny').catch(() => undefined);
    }
    this.send({ id: 'abort', type: 'abort' });
    const grace = this.deps.options.abortGraceMs ?? 5000;
    const timer = setTimeout(() => {
      this.transport.kill();
      this.finish();
    }, grace);
    await this.settled;
    clearTimeout(timer);
  }

  resolveApproval(approvalId: string, decision: 'allow' | 'deny', remember = false): Promise<void> {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      return Promise.reject(
        new AdapterError('approval_unknown', 'Permintaan izin tidak ditemukan.'),
      );
    }
    const chosen = pickOption(pending.options, decision, remember);
    if (!chosen) {
      return Promise.reject(
        new AdapterError(
          'approval_option_missing',
          'omp tidak menyediakan opsi untuk keputusan ini.',
        ),
      );
    }
    this.pending.delete(approvalId);
    this.send({ type: 'extension_ui_response', id: pending.ompId, value: chosen.value });
    this.emit({
      type: 'approval.resolved',
      approvalId,
      decision,
      remember: chosen.remembered,
    });
    return Promise.resolve();
  }
}
