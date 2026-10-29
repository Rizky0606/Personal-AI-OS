import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  QuestionSchema,
  type QuestionAnswer,
  TODO_MAX_PHASES,
  TODO_MAX_TASKS,
  TodoStatusSchema,
  type AgentEvent,
  type SteerMode,
  type QueueName,
  type SubagentStatus,
  type TodoPhase,
  type Usage,
} from '@aios/contracts';
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

/** Batas waktu tool `lsp` (detik) bila LSP dinyalakan; lihat komentar di `startRun`. */
const LSP_REQUEST_TIMEOUT_S = 60;

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

/**
 * Daftar rencana dari `result.details.phases` tool `todo`, dipangkas ke batas kontrak. Bentuk yang tidak
 * dikenal menghasilkan undefined (tidak ada event), bukan galat: ini hanya tampilan.
 */
function todoPhases(details: unknown): TodoPhase[] | undefined {
  if (!isRecord(details) || !Array.isArray(details.phases)) return undefined;
  return details.phases.slice(0, TODO_MAX_PHASES).flatMap((phase): TodoPhase[] => {
    if (!isRecord(phase) || !Array.isArray(phase.tasks)) return [];
    const tasks = phase.tasks.slice(0, TODO_MAX_TASKS).flatMap((task): TodoPhase['tasks'] => {
      if (!isRecord(task)) return [];
      const status = TodoStatusSchema.safeParse(task.status);
      if (!status.success || typeof task.content !== 'string') return [];
      const blocker = str(task.blocker);
      return [
        {
          content: clip(task.content, 200),
          status: status.data,
          ...(blocker ? { blocker: clip(blocker, 200) } : {}),
        },
      ];
    });
    return [{ name: clip(str(phase.name) ?? '', 80), tasks }];
  });
}

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
      // Pengaturan per run lewat overlay di folder run (bukan di repo kerja).
      const overlay: string[] = [];
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
        overlay.push('tools:', '  xdev: false');
      }
      // LSP (diagnostik setelah edit, definisi, referensi). Server bahasa dingin butuh ±20-25 detik di
      // panggilan pertama, lebih lama dari batas bawaan tool (20 detik, hasilnya "Operation aborted"); 60 detik
      // diuji cukup (VERIFICATION.md). Server bahasa hanya jalan bila ditemukan di worktree atau PATH.
      if (input.lsp === true) overlay.push('lsp:', `  requestTimeout: ${LSP_REQUEST_TIMEOUT_S}`);
      if (overlay.length > 0) await writeFile(overlayFile, `${overlay.join('\n')}\n`);

      const transport = await options.launch({
        runId: input.runId,
        args: [
          '--mode',
          'rpc-ui',
          // Default omp adalah yolo: tanpa ini, aturan approval SECURITY_OPS.md tidak berlaku.
          '--approval-mode',
          'always-ask',
          '--cwd',
          cwd,
          '--no-session',
          '--no-skills',
          '--no-extensions',
          ...(input.lsp === true ? [] : ['--no-lsp']),
          '--no-title',
          '--append-system-prompt',
          systemFile,
          ...(overlay.length > 0 ? ['--config', overlayFile] : []),
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
  private readonly questions = new Map<string, string>();
  private readonly subagents = new Map<
    string,
    { key: string; toolCount: number; durationMs: number }
  >();
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
        // Tool `ask` hanya ada di mode rpc-ui dan baru memakai satu permintaan `ask` setelah diaktifkan di sini;
        // tanpa ini ia meminta tiap pilihan lewat `select`/`editor` biasa (VERIFICATION.md).
        this.send({ id: 'cfg-ask', type: 'set_ask_dialog', enabled: true });
        // Subagent (tool `task`) dilaporkan sebagai frame lifecycle dan progress; bawaannya mati.
        this.send({ id: 'cfg-sub', type: 'set_subagent_subscription', level: 'progress' });
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
      case 'queue_update':
        this.onQueueUpdate(frame);
        return;
      case 'subagent_lifecycle':
      case 'subagent_progress':
        this.onSubagent(frame);
        return;
      default:
        // available_commands_update, agent_start, session_settled, response, dst.
        return;
    }
  }

  /** Antrean arahan di omp (steering dan follow-up) sebagai teks; frame tak berbentuk dugaan diabaikan. */
  private onQueueUpdate(frame: Record<string, unknown>): void {
    const list = (v: unknown) =>
      Array.isArray(v)
        ? v.flatMap((s) => (typeof s === 'string' ? [clip(s, 500)] : [])).slice(0, 20)
        : [];
    this.emit({
      type: 'queue.updated',
      steering: list(frame.steering),
      followUp: list(frame.followUp),
    });
  }

  /**
   * Subagent: frame progress membawa seluruh keadaan; lifecycle hanya status akhir/awal. Event dikirim saat
   * status atau jumlah tool berubah, bukan tiap potongan keluaran, supaya tidak membanjiri gateway.
   */
  private onSubagent(frame: Record<string, unknown>): void {
    const payload = isRecord(frame.payload) ? frame.payload : undefined;
    if (!payload) return;
    const progress = isRecord(payload.progress) ? payload.progress : undefined;
    const id = str(progress?.id) ?? str(payload.id);
    if (!id) return;
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.trunc(v) : 0);
    const raw = str(progress?.status) ?? str(payload.status);
    const status: SubagentStatus =
      raw === 'completed'
        ? 'completed'
        : raw === 'aborted' || raw === 'cancelled'
          ? 'aborted'
          : raw === 'failed' || raw === 'error'
            ? 'failed'
            : 'running';
    const previous = this.subagents.get(id);
    const tools = num(progress?.toolCount);
    const toolCount = tools > 0 ? tools : (previous?.toolCount ?? 0);
    const elapsed = num(progress?.durationMs);
    const durationMs = elapsed > 0 ? elapsed : (previous?.durationMs ?? 0);
    const key = `${status}:${toolCount}`;
    if (previous?.key === key) return;
    const output = Array.isArray(progress?.recentOutput)
      ? (progress.recentOutput as unknown[])
      : [];
    const last = [...output]
      .reverse()
      .find((o): o is string => typeof o === 'string' && o.trim() !== '');
    const parent = str(payload.parentToolCallId);
    this.subagents.set(id, { key, toolCount, durationMs });
    this.emit({
      type: 'subagent.updated',
      subagentId: clip(id, 80),
      agent: clip(str(payload.agent) ?? str(progress?.agent) ?? '', 80),
      assignment: clip(str(progress?.assignment) ?? str(payload.assignment) ?? '', 300),
      status,
      toolCount,
      durationMs,
      tokens: num(progress?.tokens),
      ...(last ? { lastOutput: clip(last.trim(), 300) } : {}),
      ...(parent ? { parentToolCallId: clip(parent, 200) } : {}),
    });
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
    // Rencana agent: tool `todo` mengembalikan seluruh daftar di result.details.phases.
    if (tool.name === 'todo' && status === 'ok') {
      const phases = todoPhases(isRecord(frame.result) ? frame.result.details : undefined);
      if (phases) this.emit({ type: 'todo.updated', phases });
    }
  }

  /** Pertanyaan agent (tool `ask`): diteruskan ke pengguna; bentuk yang tidak sah dibatalkan agar omp memakai bawaannya. */
  private onAsk(frame: Record<string, unknown>): void {
    const ompId = str(frame.id);
    if (!ompId) return;
    const raw = Array.isArray(frame.questions) ? frame.questions : [];
    const parsed = raw.map((q) => QuestionSchema.safeParse(q));
    const questions = parsed.flatMap((p) => (p.success ? [p.data] : []));
    if (questions.length === 0 || questions.length !== raw.length || questions.length > 8) {
      this.send({ type: 'extension_ui_response', id: ompId, cancelled: true });
      return;
    }
    const questionId = this.deps.newId();
    this.questions.set(questionId, ompId);
    this.emit({ type: 'question.asked', questionId, questions });
  }

  /** omp menutup dialog sendiri (batas waktu atau abort): jawaban belakangan diabaikan, jadi tampilan dibersihkan. */
  private onAskCancelled(targetId: string | undefined): void {
    const entry = [...this.questions.entries()].find(([, ompId]) => ompId === targetId);
    if (!entry) return;
    this.questions.delete(entry[0]);
    this.emit({ type: 'question.resolved', questionId: entry[0], cancelled: true });
  }

  answerQuestion(
    questionId: string,
    result: { answers: QuestionAnswer[]; cancelled: boolean },
  ): Promise<void> {
    const ompId = this.questions.get(questionId);
    if (!ompId) {
      return Promise.reject(new AdapterError('question_unknown', 'Pertanyaan tidak ditemukan.'));
    }
    this.questions.delete(questionId);
    this.send(
      result.cancelled
        ? { type: 'extension_ui_response', id: ompId, cancelled: true }
        : { type: 'extension_ui_response', id: ompId, answers: result.answers },
    );
    this.emit({ type: 'question.resolved', questionId, cancelled: result.cancelled });
    return Promise.resolve();
  }

  private onUiRequest(frame: Record<string, unknown>): void {
    if (frame.method === 'ask') return this.onAsk(frame);
    if (frame.method === 'cancel') return this.onAskCancelled(str(frame.targetId));
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

  steer(text: string, mode: SteerMode = 'steer'): Promise<void> {
    if (this.finished) {
      return Promise.reject(new AdapterError('run_finished', 'Run sudah selesai.'));
    }
    this.send(
      mode === 'followUp'
        ? { id: `follow-up-${++this.seq}`, type: 'follow_up', message: text }
        : { id: `steer-${++this.seq}`, type: 'steer', message: text },
    );
    return Promise.resolve();
  }

  /** Hasilnya (`queue_update`) datang sebagai event `queue.updated`; arahan yang sudah diproses tidak bisa ditarik. */
  removeQueued(queue: QueueName, text: string): Promise<void> {
    if (this.finished) {
      return Promise.reject(new AdapterError('run_finished', 'Run sudah selesai.'));
    }
    this.send({ id: `unqueue-${++this.seq}`, type: 'remove_queued_message', message: text, queue });
    return Promise.resolve();
  }

  async cancel(): Promise<void> {
    if (this.finished || this.cancelRequested) return;
    this.cancelRequested = true;
    // Approval yang menggantung membuat tool menunggu selamanya; tolak dulu supaya abort bisa selesai.
    for (const approvalId of [...this.pending.keys()]) {
      await this.resolveApproval(approvalId, 'deny').catch(() => undefined);
    }
    for (const questionId of [...this.questions.keys()]) {
      await this.answerQuestion(questionId, { answers: [], cancelled: true }).catch(
        () => undefined,
      );
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
