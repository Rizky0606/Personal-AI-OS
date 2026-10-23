import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { AdapterError, uuidv7, type AgentAdapter, type RunHandle } from '@aios/adapters';
import type { AgentEvent, WorkerCommand, WorkerReviewResultFrame } from '@aios/contracts';
import { PathError } from '../paths/normalize.js';
import type { ProcessManager } from '../process/manager.js';
import type { ProjectBindings } from '../projects/bindings.js';
import { COMMIT_INSTRUCTION } from './commit-message.js';
import { OmpNotFoundError } from './omp-path.js';
import { ReviewError, type ReviewService } from './review.js';
import type { ApprovalRules, RuleKind } from './rules.js';
import { WorktreeError, type Worktree, type WorktreeManager } from './worktree.js';

type StartCommand = Extract<WorkerCommand, { type: 'run.start' }>;
type ResolveCommand = Extract<WorkerCommand, { type: 'approval.resolve' }>;
type ReviewCommand = Extract<WorkerCommand, { type: 'review.apply' }>;

export interface CoordinatorDeps {
  bindings: ProjectBindings;
  worktrees: WorktreeManager;
  review: ReviewService;
  processes: ProcessManager;
  rules: ApprovalRules;
  adapter: AgentAdapter;
  /** Mengirim event ke gateway; false bila tidak tersambung (event disimpan dan dikirim saat tersambung). */
  send: (runId: string, event: AgentEvent) => boolean;
  dataDir: string;
  /** Batas waktu satu run (SECURITY_OPS.md: 30 menit). */
  maxRunMs?: number;
  maxConcurrentRuns?: number;
  log?: (message: string) => void;
}

interface RunState {
  cmd: StartCommand;
  handle: RunHandle | undefined;
  pending: Map<string, { kind: RuleKind; detail: string }>;
  /** Izin yang dijawab otomatis oleh aturan "selalu": event resolved-nya tidak diteruskan. */
  silent: Set<string>;
  outbox: AgentEvent[];
  cancelRequested: boolean;
  terminal: boolean;
  /** Mesin sudah berhenti; run tidak lagi mengubah worktree. */
  finished: boolean;
  /** Diff terakhir yang dikirim (JSON); event diff.updated hanya dikirim bila berubah. */
  diffKey: string;
  /** Ekor teks jawaban agent (untuk pesan commit). */
  text: string;
  /** Label langkah per toolCallId, untuk nama checkpoint. */
  steps: Map<string, string>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Satu frame WebSocket gateway maksimal 16 KB; event dipecah bila serialisasinya mendekati itu. */
const MAX_EVENT_JSON = 12_000;
const OUTBOX_LIMIT = 10_000;
const DEFAULT_MAX_RUN_MS = 30 * 60_000;
const TEXT_TAIL = 8000;
const RESULT_CACHE = 50;

function splitEvent(event: AgentEvent): AgentEvent[] {
  if (JSON.stringify(event).length <= MAX_EVENT_JSON) return [event];
  if (event.type === 'message.delta' || event.type === 'reasoning.delta') {
    const mid = Math.floor(event.text.length / 2);
    return [
      ...splitEvent({ ...event, text: event.text.slice(0, mid) }),
      ...splitEvent({ ...event, text: event.text.slice(mid) }),
    ];
  }
  if (event.type === 'tool.output') {
    const mid = Math.floor(event.chunk.length / 2);
    return [
      ...splitEvent({ ...event, chunk: event.chunk.slice(0, mid) }),
      ...splitEvent({ ...event, chunk: event.chunk.slice(mid) }),
    ];
  }
  return [event];
}

/**
 * Menjalankan run coding di PC ini: worktree terpisah, omp lewat adapter, approval (aturan project lebih
 * dulu, selain itu ditanyakan ke pengguna), batas waktu, dan pembersihan. Event dikirim ke gateway; selama
 * koneksi putus event ditahan dan dikirim berurutan saat tersambung lagi.
 */
export class RunCoordinator {
  private readonly runs = new Map<string, RunState>();
  /** Hasil review terakhir per run: perintah yang diulang gateway dijawab sama tanpa mengulang git. */
  private readonly results = new Map<string, WorkerReviewResultFrame>();

  constructor(private readonly deps: CoordinatorDeps) {}

  get activeRunIds(): string[] {
    return [...this.runs.keys()];
  }

  /** Mesin run masih bekerja di worktree-nya. */
  isWorking(runId: string): boolean {
    const run = this.runs.get(runId);
    return run !== undefined && !run.finished;
  }

  /** Dipanggil saat koneksi gateway pulih. */
  flushAll(): void {
    for (const [runId, run] of this.runs) this.flush(runId, run);
  }

  start(cmd: StartCommand): void {
    if (this.runs.has(cmd.runId)) return;
    const run: RunState = {
      cmd,
      handle: undefined,
      pending: new Map(),
      silent: new Set(),
      outbox: [],
      cancelRequested: false,
      terminal: false,
      finished: false,
      text: '',
      diffKey: '[]',
      steps: new Map(),
      timer: undefined,
    };
    this.runs.set(cmd.runId, run);
    void this.execute(cmd.runId, run).catch((error: unknown) => {
      this.deps.log?.(`run ${cmd.runId} gagal tak terduga: ${String(error)}`);
      this.fail(cmd.runId, run, 'worker_internal', 'Worker mengalami kesalahan tak terduga.');
    });
  }

  steer(runId: string, text: string): void {
    void this.runs
      .get(runId)
      ?.handle?.steer(text)
      .catch((error: unknown) => {
        this.deps.log?.(`steer ${runId} gagal: ${String(error)}`);
      });
  }

  cancel(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.cancelRequested = true;
    void run.handle?.cancel().catch(() => undefined);
  }

  async resolveApproval(cmd: ResolveCommand): Promise<void> {
    const run = this.runs.get(cmd.runId);
    if (!run?.handle) return;
    const entry = run.pending.get(cmd.approvalId);
    // "Selalu untuk project ini" disimpan di worker; omp hanya menerima izinkan-sekali.
    if (cmd.decision === 'allow' && cmd.remember && entry) {
      await this.deps.rules.add(run.cmd.projectId, entry.kind, entry.detail);
    }
    try {
      await run.handle.resolveApproval(cmd.approvalId, cmd.decision, false);
      run.pending.delete(cmd.approvalId);
    } catch (error) {
      this.deps.log?.(`approval ${cmd.approvalId} gagal: ${String(error)}`);
    }
  }

  /**
   * Hasil ditinjau. Diterima: perubahan jadi satu commit di branch kerja agent (branch kerja pengguna tidak
   * disentuh kecuali merge diminta dan fast-forward) lalu worktree dibersihkan. Ditolak: worktree dan branch
   * dihapus. Hasilnya dikembalikan sebagai frame `review.result` untuk gateway.
   */
  async reviewApply(cmd: ReviewCommand): Promise<WorkerReviewResultFrame> {
    const cached = this.results.get(cmd.runId);
    if (cached?.decision === cmd.decision) return cached;

    let frame: WorkerReviewResultFrame;
    try {
      const outcome =
        cmd.decision === 'accept'
          ? await this.deps.review.accept(cmd.runId, {
              merge: cmd.merge,
              commitMessage: cmd.commitMessage,
            })
          : await this.deps.review.reject(cmd.runId);
      frame = {
        type: 'review.result',
        runId: cmd.runId,
        decision: cmd.decision,
        ok: true,
        ...outcome,
      };
    } catch (error) {
      const gone = error instanceof ReviewError && error.code === 'review_not_found';
      frame = {
        type: 'review.result',
        runId: cmd.runId,
        decision: cmd.decision,
        // Menolak hasil yang sudah tidak ada (sudah dibuang) tetap berhasil: tujuannya sudah tercapai.
        ok: gone && cmd.decision === 'reject',
        branch: '',
        commit: null,
        merged: false,
        mergeSkipped: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (frame.ok) {
      this.results.set(cmd.runId, frame);
      if (this.results.size > RESULT_CACHE)
        this.results.delete(this.results.keys().next().value ?? '');
    }
    return frame;
  }

  private async execute(runId: string, run: RunState): Promise<void> {
    const { cmd } = run;
    try {
      const projectPath = await this.deps.bindings
        .pathFor(cmd.projectId)
        .catch((error: unknown) => {
          throw error instanceof PathError ? error : new Error('bind');
        });
      if (projectPath === undefined) {
        return this.fail(
          runId,
          run,
          'project_not_bound',
          'Project ini belum terikat ke folder di PC ini. Ikat folder di layar Project.',
        );
      }
      if (run.cancelRequested) return this.cancelled(runId, run);

      let worktree: Worktree;
      if (cmd.continueFromRunId) {
        worktree = this.deps.worktrees.adopt(cmd.continueFromRunId, runId);
        this.deps.review.inherit(cmd.continueFromRunId, runId);
      } else {
        worktree = await this.deps.worktrees.create(runId, projectPath);
      }
      const runDir = nodePath.join(this.deps.dataDir, 'runs', runId);
      await fs.mkdir(runDir, { recursive: true });
      if (run.cancelRequested) return this.cancelled(runId, run);

      run.handle = await this.deps.adapter.startRun({
        runId,
        messageId: uuidv7(),
        prompt: cmd.prompt,
        systemPrompt: cmd.bundle.systemPrompt + COMMIT_INSTRUCTION,
        model: cmd.model,
        projectId: cmd.projectId,
        role: cmd.bundle.role,
        cwd: worktree.cwd,
        runDir,
      });
      if (run.cancelRequested) void run.handle.cancel();

      run.timer = setTimeout(() => {
        this.forward(runId, run, {
          type: 'error',
          code: 'run_timeout',
          message: 'Run melewati batas waktu 30 menit dan dihentikan.',
          retryable: false,
        });
        run.terminal = true;
        void run.handle?.cancel();
      }, this.deps.maxRunMs ?? DEFAULT_MAX_RUN_MS);

      for await (const event of run.handle.events) await this.onEvent(runId, run, event);

      if (!run.terminal) {
        if (run.cancelRequested) this.cancelled(runId, run);
        else
          this.fail(runId, run, 'omp_ended_early', 'omp berhenti tanpa menyelesaikan run.', true);
      }
    } catch (error) {
      this.deps.log?.(
        `run ${runId} gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.fail(runId, run, ...describe(error));
    } finally {
      await this.cleanup(runId, run);
    }
  }

  private async onEvent(runId: string, run: RunState, event: AgentEvent): Promise<void> {
    if (event.type === 'approval.requested') {
      if (this.deps.rules.matches(run.cmd.projectId, event.kind, event.detail)) {
        run.silent.add(event.approvalId);
        void run.handle?.resolveApproval(event.approvalId, 'allow').catch(() => undefined);
        return;
      }
      run.pending.set(event.approvalId, { kind: event.kind, detail: event.detail });
    } else if (event.type === 'approval.resolved') {
      if (run.silent.delete(event.approvalId)) return;
      run.pending.delete(event.approvalId);
    } else if (event.type === 'message.delta') {
      run.text = (run.text + event.text).slice(-TEXT_TAIL);
    } else if (event.type === 'tool.started') {
      run.steps.set(event.toolCallId, [event.name, event.target].filter(Boolean).join(' '));
    } else if (event.type === 'run.completed') {
      // Diff terakhir harus terkirim sebelum penutup: setelah run.completed gateway tidak lagi mendengarkan.
      if (run.text === '') run.text = event.summary;
      await this.publishDiff(runId, run);
      run.terminal = true;
    } else if (event.type === 'error') {
      run.terminal = true;
    }
    this.forward(runId, run, event);
    if (event.type === 'tool.finished' && event.status === 'ok') {
      await this.checkpoint(runId, run, run.steps.get(event.toolCallId) ?? 'langkah agent');
    }
  }

  /** Checkpoint setelah langkah yang mengubah berkas, lalu diff terbaru; kegagalan tidak menghentikan run. */
  private async checkpoint(runId: string, run: RunState, label: string): Promise<void> {
    try {
      const created = await this.deps.review.checkpoint(runId, label);
      if (!created) return;
      this.forward(runId, run, {
        type: 'checkpoint.created',
        checkpointId: created.id,
        label: created.label,
      });
      await this.publishDiff(runId, run);
    } catch (error) {
      this.deps.log?.(`checkpoint ${runId} gagal: ${String(error)}`);
    }
  }

  private async publishDiff(runId: string, run: RunState): Promise<void> {
    try {
      const files = await this.deps.review.stat(runId);
      const key = JSON.stringify(files);
      if (key === run.diffKey) return;
      run.diffKey = key;
      this.forward(runId, run, { type: 'diff.updated', files });
    } catch (error) {
      this.deps.log?.(`diff ${runId} gagal: ${String(error)}`);
    }
  }

  private fail(
    runId: string,
    run: RunState,
    code: string,
    message: string,
    retryable = false,
  ): void {
    if (run.terminal) return;
    run.terminal = true;
    this.forward(runId, run, { type: 'error', code, message, retryable });
  }

  private cancelled(runId: string, run: RunState): void {
    run.terminal = true;
    this.forward(runId, run, { type: 'run.status', status: 'cancelled' });
  }

  private forward(runId: string, run: RunState, event: AgentEvent): void {
    for (const piece of splitEvent(event)) {
      if (run.outbox.length >= OUTBOX_LIMIT) run.outbox.shift();
      run.outbox.push(piece);
    }
    this.flush(runId, run);
  }

  private flush(runId: string, run: RunState): void {
    while (run.outbox.length > 0) {
      const next = run.outbox[0];
      if (!next || !this.deps.send(runId, next)) return;
      run.outbox.shift();
    }
  }

  private async cleanup(runId: string, run: RunState): Promise<void> {
    clearTimeout(run.timer);
    await this.deps.processes.killRun(runId).catch(() => undefined);
    run.finished = true;
    this.deps.review.setMeta(runId, run.text);
    // Tanpa perubahan apa pun, tidak ada yang perlu ditinjau: worktree dan branch dibuang.
    if (await this.deps.worktrees.isPristine(runId)) {
      await this.deps.worktrees.remove(runId, { deleteBranch: true });
      this.deps.review.forget(runId);
    }
    await fs
      .rm(nodePath.join(this.deps.dataDir, 'runs', runId), { recursive: true, force: true })
      .catch(() => undefined);
    // Event yang belum terkirim (koneksi putus) tetap dikirim saat tersambung; run dilepas setelah kosong.
    const release = () => {
      this.flush(runId, run);
      if (run.outbox.length === 0) this.runs.delete(runId);
      else setTimeout(release, 1000).unref();
    };
    release();
  }
}

function describe(error: unknown): [code: string, message: string, retryable: boolean] {
  if (error instanceof OmpNotFoundError) return ['omp_not_found', error.message, false];
  if (error instanceof WorktreeError) return [error.code, error.message, false];
  if (error instanceof PathError) return [error.code, error.message, false];
  if (error instanceof AdapterError) return [error.code, error.message, error.retryable];
  return ['run_start_failed', 'Run gagal dimulai di worker.', true];
}
