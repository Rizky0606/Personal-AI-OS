import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import {
  AdapterError,
  APPROVAL_DETAIL_MAX,
  uuidv7,
  type AgentAdapter,
  type RunHandle,
} from '@aios/adapters';
import {
  AIOS_DATA_TOOLS,
  AIOS_PROPOSE_TOOLS,
  AIOS_TOOLS_SERVER,
  aiosToolOf,
  connectorServerName,
  connectorToolOf,
  type AgentEvent,
  type DiffFile,
  type SteerMode,
  type WorkerCommand,
  type WorkerReviewResultFrame,
} from '@aios/contracts';
import { PathError } from '../paths/normalize.js';
import type { ProcessManager } from '../process/manager.js';
import type { ProjectBindings } from '../projects/bindings.js';
import { BROWSER_INSTRUCTION } from '../preview/instruction.js';
import type { McpRegistration } from '../preview/mcp.js';
import { BROWSER_TOOL_PREFIX, MCP_SERVER_NAME } from '../preview/mcp.js';
import type { PreviewService } from '../preview/service.js';
import type { TerminalService } from '../terminal/service.js';
import { TOOLS_INSTRUCTION, connectorInstruction } from '../tools/instruction.js';
import { COMMIT_INSTRUCTION } from './commit-message.js';
import { withHistory } from './history.js';
import { LINK_INSTRUCTION, isLinkFromPrompt } from './links.js';
import { OmpNotFoundError } from './omp-path.js';
import { isReadOnlyCommand, relativeInside } from './readonly.js';
import { ReviewError, type ReviewService } from './review.js';
import type { ApprovalRules, RuleKind } from './rules.js';
import { linkNodeModules } from '../preview/nodemodules.js';
import {
  WorktreeError,
  movesHead,
  type Workspace,
  type Worktree,
  type WorktreeManager,
} from './worktree.js';
import { runSetup, type ProjectSetupStore } from './setup.js';
import { dependencyInstruction } from './dependencies.js';
import type { CatalogSkill } from '../skills/cache.js';

type StartCommand = Extract<WorkerCommand, { type: 'run.start' }>;
type ResolveCommand = Extract<WorkerCommand, { type: 'approval.resolve' }>;
type QuestionCommand = Extract<WorkerCommand, { type: 'question.answer' }>;
type QueueCommand = Extract<WorkerCommand, { type: 'queue.remove' }>;
type ReviewCommand = Extract<WorkerCommand, { type: 'review.apply' }>;

export interface CoordinatorDeps {
  bindings: ProjectBindings;
  worktrees: WorktreeManager;
  review: ReviewService;
  processes: ProcessManager;
  rules: ApprovalRules;
  /** Perintah setup worktree per project (mis. instal dependensi); tanpa ini hanya node_modules yang ditautkan. */
  setup?: ProjectSetupStore;
  adapter: AgentAdapter;
  /** Preview website dan tool browser agent; tanpa ini run berjalan tanpa tool browser. */
  preview?: PreviewService;
  /** Terminal di worktree run ditutup sebelum worktree dihapus. */
  terminal?: TerminalService;
  /**
   * Relay MCP lokal ke server MCP yang disajikan gateway: tool gateway (`aios_tools`, dipakai hanya bila
   * run.start membawa `gatewayTools`) dan satu titik per konektor pemilik (run.start.connectors).
   */
  tools?: {
    register(runId: string): Promise<McpRegistration>;
    registerConnector(runId: string, connectorId: string): Promise<McpRegistration>;
  };
  /** Mengirim event ke gateway; false bila tidak tersambung (event disimpan dan dikirim saat tersambung). */
  send: (runId: string, event: AgentEvent) => boolean;
  /**
   * Melaporkan run in_place yang perubahannya menunggu keputusan (frame `workspace.pending`); false bila tidak
   * tersambung (laporan diulang saat tersambung lagi).
   */
  reportPending?: (runs: { runId: string; files: DiffFile[] }[]) => boolean;
  dataDir: string;
  /** Batas waktu satu run (SECURITY_OPS.md: 30 menit). */
  maxRunMs?: number;
  /** Katalog skill (cache + unduhan dari gateway) untuk skill yang ditawarkan di indeks run ini. */
  skills?: { resolve(ids: readonly string[]): Promise<CatalogSkill[]> };
  log?: (message: string) => void;
}

interface RunState {
  cmd: StartCommand;
  handle: RunHandle | undefined;
  /**
   * Izin yang menunggu pemilik. `clipped` = detail dipotong adapter, jadi "Selalu" tidak disimpan; `mayWrite` = izin
   * yang bisa mengubah berkas (tulis berkas atau perintah selain tool MCP), yang menjadikan run in_place penulis
   * begitu diberikan; `toolCallId` = langkah tool yang meminta izin, bila diketahui adapter.
   */
  pending: Map<
    string,
    { kind: RuleKind; detail: string; clipped: boolean; mayWrite: boolean; toolCallId?: string }
  >;
  /** Izin yang dijawab otomatis oleh aturan "selalu": event resolved-nya tidak diteruskan. */
  silent: Set<string>;
  /** Izin yang dijawab pemilik dengan "Selalu" dan aturannya tersimpan: event resolved-nya `remember: true`. */
  remembered: Set<string>;
  /** Izin yang dijawab dengan "Izinkan tulis berkas untuk run ini": event resolved-nya `forRun: true`. */
  forRun: Set<string>;
  /** Pemilik mengizinkan semua penulisan berkas di dalam folder kerja run ini (bukan `.git`), hanya run ini. */
  writeGrant: boolean;
  /** Sudah ada izin yang bisa mengubah berkas yang diberikan (pemilik atau otomatis). */
  writeAllowed: boolean;
  /** Penjelasan kunci repo (penulisan ditolak karena run lain menulis) sudah dikirim ke agent. */
  lockNoticeSent: boolean;
  /** Langkah tool yang izin tulisnya ditolak karena kunci repo: alasannya ikut tampil di langkah itu. */
  lockDenied: Set<string>;
  outbox: AgentEvent[];
  cancelRequested: boolean;
  terminal: boolean;
  /**
   * Mesin sudah berhenti; run tidak lagi mengubah worktree. Di-set SERENTAK dengan `terminal` (saat event
   * penutup diteruskan ke gateway: run.completed, error, timeout, atau cancelled), BUKAN setelah `cleanup()`
   * selesai -- cleanup() melakukan kerja async (stop preview, kill proses, hapus worktree pristine) yang bisa
   * makan waktu, dan menunggunya dulu membuka jendela balapan: klien bisa melihat run "selesai" lalu memanggil
   * accept/reject sebelum assertIdle() tahu run sudah tidak aktif (lihat review_apply_race di REPAIR_LOG P8).
   */
  /** Run is scoped to this bundle's skill index; tracks IDs proven opened by omp read events. */
  openedSkills: Set<string>;
  finished: boolean;
  /** Diff terakhir yang dikirim (JSON); event diff.updated hanya dikirim bila berubah. */
  diffKey: string;
  /** Ekor teks jawaban agent (untuk pesan commit). */
  text: string;
  /** Label langkah per toolCallId, untuk nama checkpoint. */
  steps: Map<string, string>;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Pendaftaran tool browser di server MCP lokal. */
  mcp: McpRegistration | undefined;
  /** Pendaftaran run di relay tool gateway (`aios_tools`). */
  toolsMcp: McpRegistration | undefined;
  /** Pendaftaran satu titik relay per konektor aktif run ini. */
  connectorMcp: McpRegistration[];
  /** Folder kerja run ini (worktree atau folder project), setelah dibuka. */
  workspace: Workspace | undefined;
  /** Mesin menyelesaikan run (`run.completed`), bukan dihentikan atau gagal. */
  completed: boolean;
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
 * Menjalankan run coding di PC ini: folder kerja (langsung di folder project pada branch aktif, atau worktree
 * terpisah), omp lewat adapter, approval (aturan project lebih dulu, selain itu ditanyakan ke pengguna), batas
 * waktu, dan pembersihan. Event dikirim ke gateway; selama koneksi putus event ditahan dan dikirim berurutan saat
 * tersambung lagi.
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
      remembered: new Set(),
      forRun: new Set(),
      writeGrant: false,
      writeAllowed: false,
      lockNoticeSent: false,
      lockDenied: new Set(),
      outbox: [],
      openedSkills: new Set(),
      cancelRequested: false,
      terminal: false,
      finished: false,
      text: '',
      diffKey: '[]',
      steps: new Map(),
      timer: undefined,
      mcp: undefined,
      toolsMcp: undefined,
      connectorMcp: [],
      workspace: undefined,
      completed: false,
    };
    this.runs.set(cmd.runId, run);
    void this.execute(cmd.runId, run).catch((error: unknown) => {
      this.deps.log?.(`run ${cmd.runId} gagal tak terduga: ${String(error)}`);
      void this.fail(cmd.runId, run, 'worker_internal', 'Worker mengalami kesalahan tak terduga.');
    });
  }

  /** Dev server run ini siap: gateway diberi tahu agar klien lain tahu (hanya selama run berjalan). */
  previewReady(runId: string, url: string): void {
    const run = this.runs.get(runId);
    if (run && !run.finished && !run.terminal)
      this.forward(runId, run, { type: 'preview.ready', url });
  }

  steer(runId: string, text: string, mode?: SteerMode): void {
    void this.runs
      .get(runId)
      ?.handle?.steer(text, mode)
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

  /** Menarik arahan dari antrean agent; hasilnya datang sebagai `queue.updated` dari adapter. */
  async removeQueued(cmd: QueueCommand): Promise<void> {
    try {
      await this.runs.get(cmd.runId)?.handle?.removeQueued(cmd.queue, cmd.text);
    } catch (error) {
      this.deps.log?.(`antrean ${cmd.runId} gagal ditarik: ${String(error)}`);
    }
  }

  /** Jawaban pengguna atas pertanyaan agent; hasilnya (`question.resolved`) datang dari adapter. */
  async answerQuestion(cmd: QuestionCommand): Promise<void> {
    const handle = this.runs.get(cmd.runId)?.handle;
    if (!handle) return;
    try {
      await handle.answerQuestion(cmd.questionId, {
        answers: cmd.answers,
        cancelled: cmd.cancelled,
      });
    } catch (error) {
      this.deps.log?.(`pertanyaan ${cmd.questionId} gagal dijawab: ${String(error)}`);
    }
  }

  async resolveApproval(cmd: ResolveCommand): Promise<void> {
    const run = this.runs.get(cmd.runId);
    if (!run?.handle) return;
    const entry = run.pending.get(cmd.approvalId);
    const mayWrite = entry?.mayWrite !== false;
    // N6: kunci repo diambil saat izin tulis DIBERIKAN, bukan saat diminta. Bila run lain di repo yang sama lebih
    // dulu menjadi penulis selagi izin ini menunggu, izin ini tidak bisa diberikan: ditolak dengan alasan yang
    // tampil di langkahnya dan dijelaskan ke agent, bukan diam-diam.
    const locked =
      cmd.decision === 'allow' && mayWrite && !this.deps.worktrees.claimWrite(cmd.runId);
    const decision = locked ? 'deny' : cmd.decision;
    const allow = decision === 'allow' && entry !== undefined;
    // "Selalu untuk project ini" disimpan di worker; omp hanya menerima izinkan-sekali. Event approval.resolved
    // dari adapter selalu `remember: false`, jadi dicatat di sini supaya event dan audit gateway jujur (B9). Detail
    // yang dipotong bukan perintah utuh: aturannya akan cocok dengan perintah lain yang awalannya sama.
    if (allow && cmd.remember && !entry.clipped) {
      await this.deps.rules.add(run.cmd.projectId, entry.kind, entry.detail);
      run.remembered.add(cmd.approvalId);
    }
    // "Izinkan tulis berkas untuk run ini": penulisan berikutnya di dalam folder kerja dijawab otomatis.
    if (allow && cmd.forRun === true && entry.kind === 'file_write') {
      run.writeGrant = true;
      run.forRun.add(cmd.approvalId);
    }
    if (decision === 'allow' && mayWrite) run.writeAllowed = true;
    try {
      await run.handle.resolveApproval(cmd.approvalId, decision, false);
      run.pending.delete(cmd.approvalId);
    } catch (error) {
      this.deps.log?.(`approval ${cmd.approvalId} gagal: ${String(error)}`);
      return;
    }
    if (locked) this.noteLockDenied(run, entry?.toolCallId);
    else if (decision === 'allow' && mayWrite) this.denyBystanderWrites();
  }

  /** Izin tulis run ini ditolak karena kunci repo: agent diberi tahu sekali, langkah tool-nya diberi alasan. */
  private noteLockDenied(run: RunState, toolCallId: string | undefined): void {
    if (toolCallId) run.lockDenied.add(toolCallId);
    if (run.lockNoticeSent) return;
    run.lockNoticeSent = true;
    void run.handle?.steer(LOCK_NOTICE).catch(() => undefined);
  }

  /**
   * Run in_place yang kini berbagi folder dengan penulis (`isBystander`) tidak akan pernah mendapat izin tulis:
   * izin tulisnya yang masih menunggu ditolak sekarang (event `approval.resolved` diteruskan, jadi panel izin di
   * aplikasi tertutup) alih-alih menunggu pemilik menekan Izinkan yang pasti gagal.
   */
  private denyBystanderWrites(): void {
    for (const [runId, other] of this.runs) {
      if (!this.deps.worktrees.isBystander(runId)) continue;
      for (const [approvalId, entry] of other.pending) {
        if (!entry.mayWrite) continue;
        other.pending.delete(approvalId);
        void other.handle?.resolveApproval(approvalId, 'deny').catch(() => undefined);
        this.noteLockDenied(other, entry.toolCallId);
      }
    }
  }

  /**
   * Hasil ditinjau. In_place: diterima = satu commit di branch aktif project; ditolak = folder project dikembalikan
   * ke base. Worktree: diterima = satu commit di branch `aios/...` (digabung ke branch kerja pengguna bila diminta)
   * lalu worktree dibersihkan; ditolak = worktree dan branch dihapus. Hasilnya frame `review.result` untuk gateway.
   */
  async reviewApply(cmd: ReviewCommand): Promise<WorkerReviewResultFrame> {
    const cached = this.results.get(cmd.runId);
    if (cached?.decision === cmd.decision) return cached;

    // Worktree akan dihapus: dev server yang berjalan di dalamnya dihentikan lebih dulu.
    await this.deps.preview?.stopByRun(cmd.runId).catch(() => undefined);
    this.deps.terminal?.closeByRun(cmd.runId);
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
      // 'run_active' seharusnya tidak pernah terjadi lagi setelah retry di assertIdle() (lihat review.ts);
      // bila tetap muncul, itu anomali nyata (bukan balapan sesaat) dan layak diketahui, bukan ditelan diam-diam.
      if (error instanceof ReviewError && error.code === 'run_active') {
        this.deps.log?.(
          `review.apply ${cmd.runId}: run_active bertahan setelah retry assertIdle (anomali, lihat BACKLOG).`,
        );
      }
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
        return await this.fail(
          runId,
          run,
          'project_not_bound',
          'Project ini belum terikat ke folder di PC ini. Ikat folder di layar Project.',
        );
      }
      if (run.cancelRequested) return await this.cancelled(runId, run);

      let worktree: Workspace;
      if (cmd.continueFromRunId) {
        if (this.isWorking(cmd.continueFromRunId)) {
          throw new WorktreeError('workspace_busy', 'Run sebelumnya masih berjalan.');
        }
        await this.deps.preview?.stopByRun(cmd.continueFromRunId).catch(() => undefined);
        this.deps.terminal?.closeByRun(cmd.continueFromRunId);
        worktree = await this.deps.worktrees.adopt(cmd.continueFromRunId, runId);
        await this.deps.review.inherit(runId);
      } else {
        // Kosong = setelan project di worker; run chat project bawaannya langsung di branch aktif.
        const mode = cmd.workspace ?? this.deps.setup?.get(cmd.projectId).workspace ?? 'in_place';
        const options = { projectId: cmd.projectId, planOnly: cmd.planOnly === true };
        worktree =
          mode === 'in_place'
            ? await this.deps.worktrees.openInPlace(runId, projectPath, options)
            : await this.deps.worktrees.create(runId, projectPath, options);
      }
      run.workspace = worktree;
      // Gateway mencatat mode dan branch run dari sini (kolom `workspace` dan `branch`).
      this.forward(runId, run, {
        type: 'workspace.ready',
        mode: worktree.kind,
        branch: worktree.branch,
        base: worktree.base,
      });
      if (!cmd.continueFromRunId && worktree.kind === 'worktree') {
        await this.prepareWorktree(runId, run, worktree, projectPath);
      }
      const runDir = nodePath.join(this.deps.dataDir, 'runs', runId);
      await fs.mkdir(runDir, { recursive: true });
      if (run.cancelRequested) return await this.cancelled(runId, run);

      run.mcp = await this.deps.preview
        ?.registerRun({ projectId: cmd.projectId, runId })
        .catch((error: unknown) => {
          this.deps.log?.(`tool browser tidak tersedia untuk run ${runId}: ${String(error)}`);
          return undefined;
        });
      // Tool gateway (web_search, web_read) hanya bila gateway menyalakannya untuk run ini.
      if (cmd.gatewayTools && this.deps.tools) {
        run.toolsMcp = await this.deps.tools.register(runId).catch((error: unknown) => {
          this.deps.log?.(`tool gateway tidak tersedia untuk run ${runId}: ${String(error)}`);
          return undefined;
        });
      }
      // Satu titik relay per konektor aktif (run.start.connectors). Worker hanya tahu id dan slug-nya:
      // URL dan token server pihak ketiga tetap di gateway (DESIGN_MCP_KONEKTOR.md #3).
      const connectorServers: Record<string, { url: string; headers: Record<string, string> }> = {};
      const connectorNames: string[] = [];
      const relay = this.deps.tools;
      if (relay && cmd.connectors?.length) {
        for (const connector of cmd.connectors) {
          const registration = await relay
            .registerConnector(runId, connector.id)
            .catch((error: unknown) => {
              this.deps.log?.(
                `konektor ${connector.name} tidak tersedia untuk run ${runId}: ${String(error)}`,
              );
              return undefined;
            });
          if (!registration) continue;
          run.connectorMcp.push(registration);
          connectorServers[connectorServerName(connector.name)] = {
            url: registration.url,
            headers: registration.headers,
          };
          connectorNames.push(connector.displayName);
        }
      }
      const mcpServers = {
        ...(run.mcp ? { [MCP_SERVER_NAME]: { url: run.mcp.url, headers: run.mcp.headers } } : {}),
        ...(run.toolsMcp
          ? { [AIOS_TOOLS_SERVER]: { url: run.toolsMcp.url, headers: run.toolsMcp.headers } }
          : {}),
        ...connectorServers,
      };

      // Skill yang ditawarkan di indeks dipasang ke folder skill milik run ini. Gagal memuat katalog tidak
      // menggagalkan run coding: agent tetap jalan tanpa skill tambahan (dicatat di log worker).
      let skills: CatalogSkill[] = [];
      if (cmd.bundle.skillIds.length > 0 && this.deps.skills) {
        try {
          skills = await this.deps.skills.resolve(cmd.bundle.skillIds);
        } catch (error) {
          this.deps.log?.(`katalog skill tidak dimuat untuk run ${runId}: ${String(error)}`);
        }
      }
      // Mode rencana menolak semua perintah, jadi ajakan meminta izin instal tidak berguna di sana.
      const dependencies = cmd.planOnly ? '' : await dependencyInstruction(worktree.cwd);
      run.handle = await this.deps.adapter.startRun({
        runId,
        messageId: uuidv7(),
        prompt: withHistory(cmd.prompt, cmd.history),
        systemPrompt:
          cmd.bundle.systemPrompt +
          COMMIT_INSTRUCTION +
          LINK_INSTRUCTION +
          (run.mcp ? BROWSER_INSTRUCTION : '') +
          (run.toolsMcp ? TOOLS_INSTRUCTION : '') +
          (connectorNames.length > 0 ? connectorInstruction(connectorNames) : '') +
          dependencies +
          (worktree.kind === 'in_place' ? inPlaceInstruction(worktree.branch) : ''),
        ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        model: cmd.model,
        skills,
        skillIds: [...cmd.bundle.skillIds],
        projectId: cmd.projectId,
        role: cmd.bundle.role,
        cwd: worktree.cwd,
        lsp: this.deps.setup?.get(cmd.projectId).lsp ?? true,
        runDir,
      });
      if (run.cancelRequested) void run.handle.cancel();

      const runTimeoutMs = cmd.timeoutMs ?? this.deps.maxRunMs ?? DEFAULT_MAX_RUN_MS;
      run.timer = setTimeout(() => {
        void this.fail(
          runId,
          run,
          'run_timeout',
          `Run melewati batas waktu ${Math.round(runTimeoutMs / 60_000)} menit dan dihentikan.`,
        ).finally(() => void run.handle?.cancel());
      }, runTimeoutMs);

      for await (const event of run.handle.events) await this.onEvent(runId, run, event);

      if (!run.terminal) {
        if (run.cancelRequested) await this.cancelled(runId, run);
        else
          await this.fail(
            runId,
            run,
            'omp_ended_early',
            'omp berhenti tanpa menyelesaikan run.',
            true,
          );
      }
    } catch (error) {
      this.deps.log?.(
        `run ${runId} gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.fail(runId, run, ...describe(error));
    } finally {
      await this.cleanup(runId, run);
    }
  }

  /**
   * Worktree baru tidak membawa node_modules dan artefak lain yang tidak ikut git. Sesuai setelan project
   * di worker (hanya pemilik yang mengisinya): perintah setup dijalankan dulu, lalu node_modules project
   * ditautkan bila diminta dan worktree belum punya sendiri. Run mode rencana tidak menjalankan apa pun.
   * Kegagalan tidak menghentikan run: langkahnya terlihat di chat.
   */
  private async prepareWorktree(
    runId: string,
    run: RunState,
    worktree: Worktree,
    projectPath: string,
  ): Promise<void> {
    const setup = this.deps.setup?.get(run.cmd.projectId);
    if (!setup || run.cmd.planOnly) return;
    if (setup.commands.length > 0) {
      await runSetup({
        processes: this.deps.processes,
        commands: setup.commands,
        cwd: worktree.cwd,
        runId,
        emit: (event) => this.forward(runId, run, event),
        isCancelled: () => run.cancelRequested,
      });
    }
    if (setup.linkNodeModules) {
      await linkNodeModules(this.deps.processes, projectPath, worktree.cwd).catch(
        (error: unknown) =>
          this.deps.log?.(`node_modules tidak ditautkan untuk run ${runId}: ${String(error)}`),
      );
    }
  }

  private async onEvent(runId: string, run: RunState, event: AgentEvent): Promise<void> {
    // Pembukaan skill yang teramati dari tool baca omp (`read skill://<nama>`). Hanya id yang ada di indeks run
    // ini yang dihitung; tidak mempengaruhi pencatatan langkah tool di bawah.
    if (
      event.type === 'tool.started' &&
      event.name === 'read' &&
      event.target?.startsWith('skill://')
    ) {
      const id = /^[a-z][a-z0-9-]*/.exec(event.target.slice('skill://'.length))?.[0];
      if (id && run.cmd.bundle.skillIds.includes(id)) run.openedSkills.add(id);
    }
    if (event.type === 'approval.requested') {
      const toolName = event.detail.split('\n')[0] ?? '';
      // Detail dipotong adapter (perintah atau argumen sangat panjang): yang terlihat bukan perintah utuh, jadi
      // tidak pernah diizinkan otomatis lewat daftar baca saja, tautan pesan, atau aturan per detail.
      const clipped = event.detail.length >= APPROVAL_DETAIL_MAX && event.detail.endsWith('…');
      // Mode rencana: agent hanya boleh membaca. Semua izin ditolak, termasuk aturan "izinkan selalu" project,
      // kecuali tool gateway yang hanya membaca (web_*, tool data): riset saat merencanakan tetap boleh. Tool usulan
      // tetap ditolak (keputusan pemilik, DESIGN_MCP_TOOLS.md #5). Tool konektor juga selalu ditolak di mode
      // rencana: yang tahu sebuah tool konektor hanya membaca atau ikut menulis adalah gateway (kolom `readOnly`
      // hasil probe), bukan worker, jadi worker menolak semuanya dan gateway menegakkan pemisahan baca/tulis
      // sebagai lapis kedua (DESIGN_MCP_KONEKTOR.md #5).
      const gatewayTool = run.toolsMcp ? aiosToolOf(toolName) : null;
      const connectorTool = connectorToolOf(toolName);
      const proposeTool = gatewayTool !== null && AIOS_PROPOSE_TOOLS.includes(gatewayTool);
      if (run.cmd.planOnly && (!gatewayTool || proposeTool)) {
        run.silent.add(event.approvalId);
        void run.handle?.resolveApproval(event.approvalId, 'deny').catch(() => undefined);
        return;
      }
      // Mode in_place: agent bekerja di branch pemilik. Perintah git yang memindahkan HEAD atau branch (commit,
      // checkout, reset, stash, rebase, ...) ditolak, termasuk bila ada aturan "izinkan selalu": hasil hanya
      // masuk ke branch lewat tinjauan pemilik.
      if (
        run.workspace?.kind === 'in_place' &&
        event.kind === 'command' &&
        movesHead(event.detail)
      ) {
        run.silent.add(event.approvalId);
        void run.handle?.resolveApproval(event.approvalId, 'deny').catch(() => undefined);
        return;
      }
      // Tool browser worker hanya menyentuh preview localhost run ini: tidak perlu mengganggu pengguna tiap screenshot.
      // Tool data gateway hanya membaca data sistem sendiri (memori, ruang, kanban project ini, jadwal) dan tidak
      // mengirim apa pun keluar; tool usulan hanya membuat usulan yang menunggu pemilik. Keduanya diizinkan tanpa
      // bertanya.
      if (
        (run.mcp && event.detail.startsWith(BROWSER_TOOL_PREFIX)) ||
        (gatewayTool && AIOS_DATA_TOOLS.includes(gatewayTool)) ||
        proposeTool
      ) {
        run.silent.add(event.approvalId);
        void run.handle?.resolveApproval(event.approvalId, 'allow').catch(() => undefined);
        return;
      }
      // Tautan yang pemilik tulis sendiri di pesannya boleh dibaca tanpa bertanya lagi. Tool konektor tidak
      // pernah ikut jalur ini: pihak ketiga selalu ditanyakan, walau argumennya memuat tautan dari pemilik.
      if (
        !clipped &&
        !connectorTool &&
        event.kind === 'network' &&
        isLinkFromPrompt(event.detail, run.cmd.prompt)
      ) {
        run.silent.add(event.approvalId);
        void run.handle?.resolveApproval(event.approvalId, 'allow').catch(() => undefined);
        return;
      }
      const root = run.workspace?.cwd;
      // Perintah baca saja di folder kerja run (readonly.ts): tidak ditanyakan dan tidak mengunci repo.
      if (
        root &&
        !clipped &&
        event.kind === 'command' &&
        (await isReadOnlyCommand(event.detail, event.cwd, root))
      ) {
        run.silent.add(event.approvalId);
        void run.handle?.resolveApproval(event.approvalId, 'allow').catch(() => undefined);
        return;
      }
      // Izin yang bisa mengubah berkas menjadikan run in_place penulis repo begitu DIBERIKAN (N6: bukan saat diminta,
      // jadi izin yang menunggu tidak menghalangi run lain). Bila run in_place lain sudah menulis di repo yang sama,
      // izin ditolak tanpa bertanya: dua penulis di satu folder tidak bisa ditinjau terpisah.
      const mayWrite =
        (event.kind === 'file_write' || event.kind === 'command') && !toolName.startsWith('mcp__');
      if (mayWrite && !this.deps.worktrees.canWrite(runId)) {
        run.silent.add(event.approvalId);
        void run.handle?.resolveApproval(event.approvalId, 'deny').catch(() => undefined);
        this.noteLockDenied(run, event.toolCallId);
        return;
      }
      // Aturan "Selalu" dan izin tulis per run untuk berkas hanya berlaku di dalam folder kerja run, bukan `.git`.
      const writeInside =
        event.kind === 'file_write' &&
        root !== undefined &&
        (await writeTargetsInside(event.detail, root));
      // Aturan tool gateway dan konektor per nama tool (baris pertama detail), jadi pemotongan argumen tidak penting.
      const byToolName = aiosToolOf(toolName) !== null || connectorTool !== null;
      const autoAllow =
        event.kind === 'file_write'
          ? writeInside &&
            (run.writeGrant || this.deps.rules.matches(run.cmd.projectId, event.kind, event.detail))
          : (!clipped || byToolName) &&
            this.deps.rules.matches(run.cmd.projectId, event.kind, event.detail);
      if (autoAllow) {
        // Pemeriksaan di atas menunggu (await): run lain bisa sudah menjadi penulis di sela-selanya.
        const granted = !mayWrite || this.deps.worktrees.claimWrite(runId);
        run.silent.add(event.approvalId);
        void run.handle
          ?.resolveApproval(event.approvalId, granted ? 'allow' : 'deny')
          .catch(() => undefined);
        if (!granted) {
          this.noteLockDenied(run, event.toolCallId);
        } else if (mayWrite) {
          run.writeAllowed = true;
          this.denyBystanderWrites();
        }
        return;
      }
      run.pending.set(event.approvalId, {
        kind: event.kind,
        detail: event.detail,
        clipped: clipped && !byToolName,
        mayWrite,
        ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      });
    } else if (event.type === 'approval.resolved') {
      if (run.silent.delete(event.approvalId)) return;
      run.pending.delete(event.approvalId);
      const remembered = run.remembered.delete(event.approvalId);
      const forRun = run.forRun.delete(event.approvalId);
      if (remembered || forRun) {
        this.forward(runId, run, {
          ...event,
          remember: remembered,
          ...(forRun ? { forRun: true } : {}),
        });
        return;
      }
    } else if (event.type === 'message.delta') {
      run.text = (run.text + event.text).slice(-TEXT_TAIL);
    } else if (event.type === 'tool.started') {
      run.steps.set(event.toolCallId, [event.name, event.target].filter(Boolean).join(' '));
    } else if (event.type === 'tool.finished' && run.lockDenied.delete(event.toolCallId)) {
      // Alasan penolakan otomatis tampil di langkahnya (omp hanya menulis "denied by user").
      this.forward(runId, run, {
        type: 'tool.output',
        toolCallId: event.toolCallId,
        chunk: LOCK_REASON,
        stream: 'stderr',
      });
    } else if (event.type === 'run.completed') {
      // Diff terakhir harus terkirim sebelum penutup: setelah run.completed gateway tidak lagi mendengarkan.
      if (run.text === '') run.text = event.summary;
      await this.publishDiff(runId, run);
      run.terminal = true;
      run.finished = true;
      run.completed = true;
    } else if (event.type === 'error') {
      run.terminal = true;
      run.finished = true;
      // Run in_place yang gagal dengan perubahan tetap bisa ditinjau: gateway butuh diff terakhir sebelum penutup.
      await this.publishDiff(runId, run);
    }
    this.forward(runId, run, event);
    // Pembaca yang berbagi folder dengan penulis lain: perubahan yang terlihat di folder itu milik penulis.
    if (
      event.type === 'tool.finished' &&
      event.status === 'ok' &&
      !run.cmd.planOnly &&
      !this.deps.worktrees.isBystander(runId)
    ) {
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
    // Mode rencana tidak mengubah berkas; di in_place isinya bisa memuat perubahan pemilik, jadi tidak dilaporkan.
    // Begitu pula pembaca yang berbagi folder dengan penulis lain: perubahan di folder itu milik penulis.
    if (!run.workspace || run.workspace.planOnly || this.deps.worktrees.isBystander(runId)) return;
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

  /**
   * Penutup gagal. Status `terminal`/`finished` di-set lebih dulu (lihat `RunState.finished`), lalu diff terakhir
   * dikirim sebelum event error: gateway memutuskan run in_place yang berhenti dengan perubahan tetap bisa ditinjau.
   */
  private async fail(
    runId: string,
    run: RunState,
    code: string,
    message: string,
    retryable = false,
  ): Promise<void> {
    if (run.terminal) return;
    run.terminal = true;
    run.finished = true;
    await this.publishDiff(runId, run);
    this.forward(runId, run, { type: 'error', code, message, retryable });
  }

  private async cancelled(runId: string, run: RunState): Promise<void> {
    run.terminal = true;
    run.finished = true;
    await this.publishDiff(runId, run);
    this.forward(runId, run, { type: 'run.status', status: 'cancelled' });
  }

  private forward(runId: string, run: RunState, event: AgentEvent): void {
    for (const piece of splitEvent(event)) {
      if (run.outbox.length >= OUTBOX_LIMIT) run.outbox.shift();
      run.outbox.push(piece);
    }
    if (event.type === 'run.completed' || event.type === 'error') {
      const openedSkills = [...run.openedSkills];
      if (openedSkills.length)
        run.outbox.splice(Math.max(0, run.outbox.length - 1), 0, {
          type: 'context.used',
          runId,
          role: run.cmd.bundle.role,
          engine: 'omp',
          model: run.cmd.model,
          skills: [],
          openedSkills,
          pinnedSkills: [],
          memory: { read: 0 },
          attachments: [],
        });
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
    // Dev server dan browser milik run dihentikan begitu agent selesai (SECURITY_OPS: proses anak mati bersama run).
    run.mcp?.unregister();
    // Token relay tool gateway run ini berhenti berlaku; gateway juga menolak run yang tidak lagi berjalan.
    run.toolsMcp?.unregister();
    // Begitu pula titik relay tiap konektor: tokennya hanya berlaku selama run ini.
    for (const connector of run.connectorMcp) connector.unregister();
    run.connectorMcp = [];
    await this.deps.preview?.stopRun(run.cmd.projectId, runId).catch(() => undefined);
    await this.deps.processes.killRun(runId).catch(() => undefined);
    // Sudah di-set serentak dengan `terminal` (onEvent/fail/cancelled/timeout); diulang di sini hanya sebagai
    // jaring pengaman jika suatu saat ada jalur baru yang lolos dari situ.
    run.finished = true;
    await this.deps.review
      .setMeta(runId, run.text)
      .catch((error: unknown) =>
        this.deps.log?.(`usulan pesan commit ${runId} gagal disimpan: ${String(error)}`),
      );
    const workspace = this.deps.worktrees.get(runId);
    if (workspace) {
      if (
        workspace.planOnly ||
        this.deps.worktrees.isBystander(runId) ||
        (await this.deps.worktrees.isPristine(runId))
      ) {
        // Tanpa perubahan, mode rencana, atau pembaca yang berbagi folder dengan penulis lain (tidak pernah mendapat
        // izin tulis, jadi perubahan di folder bukan miliknya) tidak ada yang perlu ditinjau: worktree dan branch
        // `aios/...` dibuang; in_place hanya melepas catatannya (folder project dan branch pemilik tidak disentuh).
        await this.deps.worktrees.remove(runId, { deleteBranch: true });
      } else if (workspace.kind === 'in_place' || run.completed) {
        // In_place yang dihentikan atau gagal tetap bisa ditinjau: perubahannya ada di folder project pemilik.
        await this.deps.worktrees.setState(runId, 'review');
        if (workspace.kind === 'in_place' && !run.completed) await this.reportPending();
      } else {
        // Worktree run yang dihentikan atau gagal tidak bisa ditinjau; dibersihkan saat worker mulai berikutnya.
        await this.deps.worktrees.setState(runId, 'stale');
      }
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

  /**
   * Melaporkan run in_place yang perubahannya menunggu keputusan dan tidak sedang dikerjakan mesin (frame
   * `workspace.pending`). Dipanggil saat tersambung ke gateway (termasuk setelah worker dimulai ulang) dan saat run
   * in_place berhenti sebelum selesai; gateway menjadikan run itu `needs_review`.
   */
  async reportPending(): Promise<void> {
    if (!this.deps.reportPending) return;
    const runs: { runId: string; files: DiffFile[] }[] = [];
    for (const ws of this.deps.worktrees.pendingInPlace()) {
      if (this.isWorking(ws.runId)) continue;
      const files = await this.deps.review.stat(ws.runId).catch(() => []);
      if (files.length > 0) runs.push({ runId: ws.runId, files });
    }
    if (runs.length > 0) this.deps.reportPending(runs.slice(0, 100));
  }
}

/** Dikirim sekali ke agent saat izin tulisnya ditolak karena run in_place lain sudah menulis di repo yang sama. */
const LOCK_NOTICE =
  'Catatan sistem: folder project ini sedang diubah oleh run lain, jadi run ini hanya boleh membaca. Penulisan berkas dan perintah selain baca saja akan ditolak otomatis. Selesaikan dengan jawaban atau rencana tanpa mengubah berkas, dan sebutkan bahwa perubahan bisa dijalankan setelah run lain selesai.';

/** Alasan yang tampil di langkah tool yang izin tulisnya ditolak otomatis karena kunci repo. */
const LOCK_REASON =
  'Ditolak otomatis: run lain sedang mengubah folder project ini, jadi run ini hanya boleh membaca. Jalankan lagi setelah run itu selesai, atau di worktree terpisah.';

/** Segmen `.git` termasuk varian yang sama di sistem berkas Windows/macOS (`.GIT`, `.git.`, `.git `). */
const GIT_DIR_SEGMENT = /(?:^|[\\/])\.git[. ]*(?:[\\/]|$)/i;

/**
 * Semua target izin tulis berkas (`Path:`/`File:` di detail omp, sebelum `Content:`) ada di dalam folder kerja run
 * dan tidak di `.git`, baik menurut path yang ditulis maupun setelah symlink diselesaikan. Detail tanpa target yang
 * dikenali, atau yang dipotong sebelum `Content:` (daftar target bisa tidak lengkap), dianggap tidak aman.
 */
export async function writeTargetsInside(detail: string, root: string): Promise<boolean> {
  const contentAt = detail.search(/\nContent:/);
  const clipped = detail.length >= APPROVAL_DETAIL_MAX && detail.endsWith('…');
  if (clipped && contentAt < 0) return false;
  const header = contentAt < 0 ? detail : detail.slice(0, contentAt);
  const targets = [...header.matchAll(/^(?:Path|File): (.+)$/gm)].map((m) => (m[1] ?? '').trim());
  if (targets.length === 0) return false;
  for (const target of targets) {
    const full = nodePath.resolve(root, target);
    if (GIT_DIR_SEGMENT.test(nodePath.relative(root, full))) return false;
    const resolved = await relativeInside(root, full);
    if (resolved === undefined || GIT_DIR_SEGMENT.test(resolved)) return false;
  }
  return true;
}

/**
 * Catatan pesan sistem untuk run in_place: agent bekerja di folder project pemilik pada branch aktif, bukan salinan.
 * Perintah git yang memindahkan HEAD ditolak worker (`movesHead`); catatan ini mencegah agent membuang langkah.
 */
function inPlaceInstruction(branch: string): string {
  return [
    '',
    '',
    '# Folder kerja',
    `Anda bekerja langsung di folder project pemilik, di branch \`${branch}\` yang sedang aktif (bukan salinan). Jangan menjalankan perintah git yang memindahkan HEAD atau branch (commit, checkout, switch, reset, stash, rebase, merge, pull, cherry-pick, revert): worker menolaknya. Perubahan Anda di-commit ke branch ini oleh pemilik setelah ia meninjaunya.`,
  ].join('\n');
}

function describe(error: unknown): [code: string, message: string, retryable: boolean] {
  if (error instanceof OmpNotFoundError) return ['omp_not_found', error.message, false];
  if (error instanceof WorktreeError) return [error.code, error.message, false];
  if (error instanceof PathError) return [error.code, error.message, false];
  if (error instanceof AdapterError) return [error.code, error.message, error.retryable];
  return ['run_start_failed', 'Run gagal dimulai di worker.', true];
}
