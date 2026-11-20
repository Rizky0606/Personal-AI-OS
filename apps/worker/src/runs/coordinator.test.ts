import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AdapterError,
  APPROVAL_DETAIL_MAX,
  AsyncQueue,
  type AgentAdapter,
  type RunHandle,
  type StartRunInput,
} from '@aios/adapters';
import { workerBranchFor, type AgentEvent, type WorkerCommand } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllowList } from '../paths/allowlist.js';
import { canonicalize } from '../paths/normalize.js';
import { ProcessManager } from '../process/manager.js';
import { ProjectBindings } from '../projects/bindings.js';
import { ReviewService } from './review.js';
import { RunCoordinator, writeTargetsInside } from './coordinator.js';
import { OmpNotFoundError } from './omp-path.js';
import { ProjectSetupStore } from './setup.js';
import { ApprovalRules } from './rules.js';
import { WorktreeManager } from './worktree.js';

type StartCommand = Extract<WorkerCommand, { type: 'run.start' }>;

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN_2 = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const MSG = '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92';
const APPROVAL = '0192f0c4-7a1b-7c2d-a003-4a5b6c7d8e93';
const APPROVAL_2 = '0192f0c4-7a1b-7c2d-a004-4a5b6c7d8e94';

class FakeHandle implements RunHandle {
  readonly events = new AsyncQueue<AgentEvent>();
  readonly steered: string[] = [];
  readonly steerModes: (string | undefined)[] = [];
  readonly resolved: [string, string, boolean | undefined][] = [];
  readonly answered: { questionId: string; answers: unknown[]; cancelled: boolean }[] = [];
  readonly unqueued: [string, string][] = [];
  removeQueued(queue: string, text: string) {
    this.unqueued.push([queue, text]);
    return Promise.resolve();
  }
  cancelled = false;
  constructor(readonly runId: string) {}
  steer(text: string, mode?: string) {
    this.steered.push(text);
    this.steerModes.push(mode);
    return Promise.resolve();
  }
  cancel() {
    this.cancelled = true;
    this.events.end();
    return Promise.resolve();
  }
  answerQuestion(
    questionId: string,
    result: { answers: unknown[]; cancelled: boolean },
  ): Promise<void> {
    this.answered.push({ questionId, ...result });
    return Promise.resolve();
  }
  resolveApproval(id: string, decision: 'allow' | 'deny', remember?: boolean) {
    this.resolved.push([id, decision, remember]);
    // Seperti adapter sungguhan: keputusan menghasilkan event approval.resolved.
    this.events.push({ type: 'approval.resolved', approvalId: id, decision, remember: false });
    return Promise.resolve();
  }
}

class FakeAdapter implements AgentAdapter {
  readonly id = 'omp' as const;
  inputs: StartRunInput[] = [];
  handles: FakeHandle[] = [];
  failWith: Error | undefined;
  capabilities = () => ({ streaming: true, approvals: true, steer: true, checkpoints: false });
  startRun(input: StartRunInput) {
    if (this.failWith) return Promise.reject(this.failWith);
    this.inputs.push(input);
    const handle = new FakeHandle(input.runId);
    this.handles.push(handle);
    return Promise.resolve(handle);
  }
  get handle(): FakeHandle {
    const h = this.handles.at(-1);
    if (!h) throw new Error('belum ada run');
    return h;
  }
}

let base: string;
let repo: string;
let adapter: FakeAdapter;
let coordinator: RunCoordinator;
let worktrees: WorktreeManager;
let review: ReviewService;
let rules: ApprovalRules;
let online: boolean;
let sent: { runId: string; event: AgentEvent }[];
let bindings: ProjectBindings;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

const command = (over: Partial<StartCommand> = {}): StartCommand => ({
  type: 'run.start',
  runId: RUN,
  projectId: PROJECT,
  prompt: 'tambahkan tes untuk fungsi add',
  bundle: { role: 'frontend', systemPrompt: '# Peran: Frontend', skillIds: [] },
  model: 'combo/code',
  // Tes lama menguji mode worktree; mode in_place (bawaan) diuji tersendiri di bawah.
  workspace: 'worktree',
  ...over,
});

// `workspace.ready` (selalu event pertama setelah folder kerja siap) diuji tersendiri; tes lama melihat sisanya.
const events = (runId = RUN) =>
  sent.filter((s) => s.runId === runId && s.event.type !== 'workspace.ready').map((s) => s.event);
const types = (runId = RUN) => events(runId).map((e) => e.type);

async function until(check: () => boolean, label: string, ms = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function build(
  over: {
    maxRunMs?: number;
    setup?: ProjectSetupStore;
    skills?: ConstructorParameters<typeof RunCoordinator>[0]['skills'];
    tools?: ConstructorParameters<typeof RunCoordinator>[0]['tools'];
    reportPending?: ConstructorParameters<typeof RunCoordinator>[0]['reportPending'];
  } = {},
) {
  const allowed = new AllowList({ file: path.join(base, 'data', 'allowed.json'), forbidden: [] });
  await allowed.add(path.join(base, 'izin'));
  bindings = new ProjectBindings(path.join(base, 'data', 'projects.json'), allowed);
  await bindings.bind(PROJECT, repo);
  rules = new ApprovalRules(path.join(base, 'data', 'rules.json'));
  await rules.load();
  const processes = new ProcessManager({
    checkCwd: async (cwd) => {
      try {
        return await allowed.resolveDirectory(cwd);
      } catch (error) {
        const real = await canonicalize(cwd);
        if (worktrees.contains(real)) return real;
        throw error;
      }
    },
  });
  worktrees = new WorktreeManager({ processes, allowed, dataDir: path.join(base, 'data') });
  adapter = new FakeAdapter();
  review = new ReviewService({ worktrees, isWorking: (id) => coordinator.isWorking(id) });
  coordinator = new RunCoordinator({
    bindings,
    worktrees,
    review,
    processes,
    rules,
    adapter,
    send: (runId, event) => {
      if (!online) return false;
      sent.push({ runId, event });
      return true;
    },
    dataDir: path.join(base, 'data'),
    ...over,
  });
}

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-coord-')));
  repo = path.join(base, 'izin', 'aplikasi');
  await fs.mkdir(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(repo, 'math.js'), 'exports.add = (a, b) => a + b;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'awal');
  online = true;
  sent = [];
  await build();
});
afterEach(async () => {
  // Run yang dibiarkan menggantung oleh tes dihentikan dulu, supaya pembersihannya (termasuk catatan
  // workspaces.json di folder data) selesai sebelum folder sementara dihapus, juga saat mesin sibuk.
  for (const runId of coordinator.activeRunIds) coordinator.cancel(runId);
  await until(() => coordinator.activeRunIds.length === 0, 'run dilepas', 10_000).catch(
    () => undefined,
  );
  await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('RunCoordinator: memulai run', () => {
  it('worktree terpisah di luar repo: adapter dijalankan dengan cwd worktree, role, model, dan folder run di luar worktree', async () => {
    coordinator.start(command());
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');

    const input = adapter.inputs[0]!;
    expect(input).toMatchObject({
      runId: RUN,
      prompt: 'tambahkan tes untuk fungsi add',
      systemPrompt: expect.stringContaining('# Peran: Frontend') as string,
      model: 'combo/code',
      projectId: PROJECT,
      role: 'frontend',
    });
    expect(input.cwd).toBe(worktrees.get(RUN)?.cwd);
    expect(input.cwd?.startsWith(repo)).toBe(false);
    expect(path.basename(path.dirname(input.cwd ?? ''))).toBe('.aios-worktrees');
    expect(git(input.cwd ?? '', 'branch', '--show-current')).toBe(workerBranchFor(RUN));
    expect(input.runDir?.startsWith(path.join(base, 'data', 'runs'))).toBe(true);
    // Repo asli tidak tersentuh.
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('project belum terikat ke folder: error jelas, adapter tidak dimulai, tanpa worktree', async () => {
    coordinator.start(command({ projectId: '0192f0c4-7a1b-7c2d-a009-4a5b6c7d8e99' }));
    await until(() => types().length > 0, 'error');

    expect(events()).toEqual([
      expect.objectContaining({ type: 'error', code: 'project_not_bound', retryable: false }),
    ]);
    expect(adapter.inputs).toHaveLength(0);
    expect(worktrees.get(RUN)).toBeUndefined();
  });

  it('folder project bukan repo git: error not_a_repo', async () => {
    await fs.rm(path.join(repo, '.git'), { recursive: true, force: true });

    coordinator.start(command());
    await until(() => types().length > 0, 'error');

    expect(events()[0]).toMatchObject({ type: 'error', code: 'not_a_repo' });
  });

  it('omp tidak ditemukan: error omp_not_found dan worktree dibersihkan', async () => {
    adapter.failWith = new OmpNotFoundError();

    coordinator.start(command());
    await until(() => types().length > 0, 'error');
    await until(() => worktrees.get(RUN) === undefined, 'worktree dibersihkan');

    expect(events()[0]).toMatchObject({ type: 'error', code: 'omp_not_found' });
    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');
  });

  it('kegagalan adapter dengan kode jelas diteruskan apa adanya', async () => {
    adapter.failWith = new AdapterError('omp_config', 'cwd wajib', false);

    coordinator.start(command());
    await until(() => types().length > 0, 'error');

    expect(events()[0]).toMatchObject({ type: 'error', code: 'omp_config' });
  });

  it('start ganda untuk run yang sama diabaikan', async () => {
    coordinator.start(command());
    coordinator.start(command());
    await until(() => adapter.inputs.length >= 1, 'adapter');
    await new Promise((r) => setTimeout(r, 50));

    expect(adapter.inputs).toHaveLength(1);
  });
});

describe('RunCoordinator: setup worktree', () => {
  async function withSetup(setup: {
    commands?: string[];
    linkNodeModules?: boolean;
    lsp?: boolean;
  }) {
    const store = new ProjectSetupStore(path.join(base, 'data', 'setup.json'));
    await store.set(PROJECT, {
      commands: [],
      linkNodeModules: false,
      lsp: true,
      workspace: 'worktree',
      ...setup,
    });
    await build({ setup: store });
  }

  it('perintah setup jalan di worktree sebelum agent mulai dan tampil sebagai langkah setup', async () => {
    await withSetup({ commands: ['node --version'], linkNodeModules: false });

    coordinator.start(command());
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');

    const seen = events();
    expect(seen[0]).toMatchObject({
      type: 'tool.started',
      name: 'setup',
      target: 'node --version',
    });
    expect(seen.find((e) => e.type === 'tool.output')).toMatchObject({
      chunk: expect.stringMatching(/^v\d+\./) as string,
    });
    expect(seen.find((e) => e.type === 'tool.finished')).toMatchObject({ status: 'ok' });
  });

  it('perintah gagal: terlihat sebagai galat, perintah berikutnya dilewati, run tetap dimulai', async () => {
    await withSetup({
      commands: ['node --bukan-flag-nyata', 'node --version'],
      linkNodeModules: false,
    });

    coordinator.start(command());
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');

    const started = events().filter((e) => e.type === 'tool.started');
    expect(started).toHaveLength(1);
    expect(events().find((e) => e.type === 'tool.finished')).toMatchObject({ status: 'error' });
  });

  it('mode rencana tidak menjalankan perintah setup', async () => {
    await withSetup({ commands: ['node --version'], linkNodeModules: false });

    coordinator.start(command({ planOnly: true }));
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');

    expect(types()).not.toContain('tool.started');
  });

  async function linkedAfterStart(linkNodeModules: boolean) {
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'ignore');
    await fs.mkdir(path.join(repo, 'node_modules'));
    await withSetup({ commands: [], linkNodeModules });

    coordinator.start(command());
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');

    const link = path.join(worktrees.get(RUN)?.cwd ?? '', 'node_modules');
    return fs.lstat(link).then(
      (s) => s.isSymbolicLink(),
      () => false,
    );
  }

  it('node_modules ditautkan ke worktree bila diminta', async () => {
    expect(await linkedAfterStart(true)).toBe(true);
  });

  it('node_modules tidak ditautkan secara bawaan (tautan memberi agent akses tulis ke folder asli)', async () => {
    expect(await linkedAfterStart(false)).toBe(false);
  });

  async function promptWithPackage(over: { linkNodeModules?: boolean; planOnly?: boolean }) {
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"aplikasi"}\n');
    await fs.writeFile(path.join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'paket');
    await fs.mkdir(path.join(repo, 'node_modules'));
    await withSetup({ commands: [], linkNodeModules: over.linkNodeModules ?? false });

    coordinator.start(command(over.planOnly ? { planOnly: true } : {}));
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');
    return adapter.inputs[0]?.systemPrompt ?? '';
  }

  it('worktree tanpa node_modules: agent diarahkan meminta izin instal sesuai lockfile sebelum verifikasi', async () => {
    const prompt = await promptWithPackage({});
    expect(prompt).toContain('# Dependensi worktree');
    expect(prompt).toContain('`pnpm install --frozen-lockfile`');
  });

  it('node_modules sudah ada di worktree (ditautkan): tanpa catatan dependensi', async () => {
    expect(await promptWithPackage({ linkNodeModules: true })).not.toContain(
      '# Dependensi worktree',
    );
  });

  it('mode rencana: tanpa catatan dependensi (semua perintah ditolak)', async () => {
    expect(await promptWithPackage({ planOnly: true })).not.toContain('# Dependensi worktree');
  });
});

describe('RunCoordinator: event dan approval', () => {
  async function running() {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    return adapter.handle;
  }

  it('meneruskan event berurutan; run.completed menutup run dan worktree dengan perubahan dipertahankan', async () => {
    const handle = await running();
    const wt = worktrees.get(RUN)!;
    await fs.writeFile(path.join(wt.cwd, 'math.test.js'), 'tes');

    handle.events.push({ type: 'message.delta', messageId: MSG, text: 'Halo' });
    handle.events.push({ type: 'run.completed', summary: 'Tes ditambahkan' });
    handle.events.end();
    await until(() => coordinator.activeRunIds.length === 0, 'run dilepas');

    // Diff terakhir terkirim sebelum penutup: setelah run.completed gateway tidak lagi mendengarkan.
    expect(types()).toEqual(['message.delta', 'diff.updated', 'run.completed']);
    expect(events()[1]).toMatchObject({
      files: [{ path: 'math.test.js', additions: 1, deletions: 0 }],
    });
    expect(worktrees.get(RUN)).toBeDefined();
    await expect(fs.stat(path.join(wt.cwd, 'math.test.js'))).resolves.toBeDefined();
  });

  it('run selesai tanpa perubahan: worktree dan branch dibuang', async () => {
    const handle = await running();

    handle.events.push({ type: 'run.completed', summary: 'Tidak ada yang berubah' });
    handle.events.end();
    await until(() => worktrees.get(RUN) === undefined, 'worktree dibuang');

    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');
  });

  it('izin diminta: diteruskan ke gateway, Izinkan sekali dijawab ke adapter tanpa menyimpan aturan', async () => {
    const handle = await running();
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'node --test',
      cwd: worktrees.get(RUN)?.cwd ?? '',
    });
    await until(() => types().includes('approval.requested'), 'permintaan izin');

    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: false,
    });

    expect(handle.resolved).toEqual([[APPROVAL, 'allow', false]]);
    await until(() => types().includes('approval.resolved'), 'approval.resolved');
    expect(rules.matches(PROJECT, 'command', 'node --test')).toBe(false);
  });

  it('"Selalu untuk project ini" menyimpan pola; permintaan sama berikutnya dijawab otomatis tanpa bertanya', async () => {
    const handle = await running();
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'node --test',
    });
    await until(() => types().includes('approval.requested'), 'permintaan izin');
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: true,
    });
    await until(() => handle.resolved.length === 1, 'dijawab');
    // B9: aturan tersimpan, jadi event yang diteruskan ke gateway mencatat remember: true.
    await until(() => types().includes('approval.resolved'), 'approval.resolved');
    expect(events().find((e) => e.type === 'approval.resolved')).toMatchObject({
      approvalId: APPROVAL,
      remember: true,
    });
    const before = sent.length;

    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'command',
      detail: 'node   --test',
    });
    await until(() => handle.resolved.length === 2, 'dijawab otomatis');

    expect(handle.resolved[1]).toEqual([APPROVAL_2, 'allow', undefined]);
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.length).toBe(before); // tidak ada permintaan atau hasil yang diteruskan ke pengguna
    expect(rules.matches(PROJECT, 'command', 'node --test')).toBe(true);
  });

  it('perintah baca saja di folder run diizinkan tanpa bertanya; cwd di luar atau perintah lain tetap ditanyakan', async () => {
    const handle = await running();
    const cwd = worktrees.get(RUN)?.cwd ?? '';
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'git diff --stat',
      cwd,
    });
    await until(() => handle.resolved.length === 1, 'dijawab otomatis');
    expect(handle.resolved[0]).toEqual([APPROVAL, 'allow', undefined]);

    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'command',
      detail: 'git status',
      cwd: base,
    });
    const third = '0192f0c4-7a1b-7c2d-a005-4a5b6c7d8e97';
    handle.events.push({
      type: 'approval.requested',
      approvalId: third,
      kind: 'command',
      detail: 'git diff && npm test',
      cwd,
    });
    await until(
      () => types().filter((t) => t === 'approval.requested').length === 2,
      'dua permintaan diteruskan',
    );
    expect(handle.resolved).toHaveLength(1);
  });

  it('"Izinkan tulis berkas untuk run ini": tulis berikutnya di folder run otomatis, .git dan luar folder tetap ditanyakan, run lain tidak', async () => {
    const handle = await running();
    const write = (approvalId: string, path: string) =>
      handle.events.push({
        type: 'approval.requested',
        approvalId,
        kind: 'file_write',
        detail: `Path: ${path}\nContent:\nisi`,
      });
    write(APPROVAL, 'a.ts');
    await until(() => types().includes('approval.requested'), 'permintaan izin');
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: false,
      forRun: true,
    });
    await until(() => types().includes('approval.resolved'), 'approval.resolved');
    expect(events().find((e) => e.type === 'approval.resolved')).toMatchObject({
      remember: false,
      forRun: true,
    });
    // Tidak menjadi aturan project.
    expect(rules.list(PROJECT)).toEqual([]);

    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'file_write',
      detail: 'File: src/b.ts',
    });
    await until(() => handle.resolved.length === 2, 'tulis kedua otomatis');
    expect(handle.resolved[1]).toEqual([APPROVAL_2, 'allow', undefined]);

    const before = types().filter((t) => t === 'approval.requested').length;
    write('0192f0c4-7a1b-7c2d-a005-4a5b6c7d8e98', '.git/config');
    write('0192f0c4-7a1b-7c2d-a005-4a5b6c7d8e99', '../luar.txt');
    await until(
      () => types().filter((t) => t === 'approval.requested').length === before + 2,
      '.git dan luar folder ditanyakan',
    );
    expect(handle.resolved).toHaveLength(2);
  });

  it('detail izin yang dipotong adapter: tidak diizinkan otomatis (baca saja, aturan), "Selalu" tidak disimpan', async () => {
    const handle = await running();
    const cwd = worktrees.get(RUN)?.cwd ?? '';
    // `ls a a a …; rm -rf x`: bagian berbahaya jatuh setelah batas potong, yang terlihat hanya `ls a a a …`.
    const full = `ls ${'a '.repeat(APPROVAL_DETAIL_MAX)}; rm -rf x`;
    const clipped = `${full.slice(0, APPROVAL_DETAIL_MAX - 1)}…`;
    // Aturan lama yang tersimpan dari detail terpotong yang sama juga tidak berlaku.
    await rules.add(PROJECT, 'command', clipped);
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: clipped,
      cwd,
    });
    await until(() => types().includes('approval.requested'), 'ditanyakan ke pemilik');
    expect(handle.resolved).toHaveLength(0);

    await rules.remove(PROJECT);
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: true,
    });
    await until(() => types().includes('approval.resolved'), 'approval.resolved');
    expect(rules.list(PROJECT)).toEqual([]);
    expect(events().find((e) => e.type === 'approval.resolved')).toMatchObject({ remember: false });
  });

  it('mode rencana: semua izin ditolak otomatis tanpa bertanya, juga yang punya aturan "selalu"', async () => {
    await rules.add(PROJECT, 'command', 'node --test');
    coordinator.start(command({ planOnly: true }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;

    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'node --test',
    });
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'file_write',
      detail: 'src/app.js',
    });
    await until(() => handle.resolved.length === 2, 'ditolak otomatis');

    expect(handle.resolved).toEqual([
      [APPROVAL, 'deny', undefined],
      [APPROVAL_2, 'deny', undefined],
    ]);
    await new Promise((r) => setTimeout(r, 30));
    // Pengguna tidak ditanya apa pun dan tidak ada yang diteruskan ke gateway.
    expect(types()).toEqual([]);
  });

  it('penarikan arahan dari antrean diteruskan ke adapter', async () => {
    const handle = await running();

    await coordinator.removeQueued({
      type: 'queue.remove',
      runId: RUN,
      queue: 'followUp',
      text: 'lalu lint',
    });

    expect(handle.unqueued).toEqual([['followUp', 'lalu lint']]);
  });

  it('jawaban pertanyaan agent diteruskan ke adapter; run yang tidak ada diabaikan', async () => {
    const handle = await running();

    await coordinator.answerQuestion({
      type: 'question.answer',
      runId: RUN,
      questionId: APPROVAL,
      answers: [{ id: 'db', selectedOptions: ['SQLite'] }],
      cancelled: false,
    });
    await coordinator.answerQuestion({
      type: 'question.answer',
      runId: RUN_2,
      questionId: APPROVAL,
      answers: [],
      cancelled: true,
    });

    expect(handle.answered).toEqual([
      {
        questionId: APPROVAL,
        answers: [{ id: 'db', selectedOptions: ['SQLite'] }],
        cancelled: false,
      },
    ]);
  });

  it('aturan tidak berlaku untuk perintah lain atau project lain', async () => {
    await rules.add(PROJECT, 'command', 'node --test');
    const handle = await running();

    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'node --test && rm -rf .',
    });
    await until(() => types().includes('approval.requested'), 'tetap bertanya');

    expect(handle.resolved).toEqual([]);
  });

  it('Tolak diteruskan ke adapter dan tidak pernah disimpan sebagai aturan', async () => {
    const handle = await running();
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'network',
      detail: 'https://x.test',
    });
    await until(() => types().includes('approval.requested'), 'permintaan');

    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'deny',
      remember: true,
    });

    expect(handle.resolved).toEqual([[APPROVAL, 'deny', false]]);
    expect(rules.list(PROJECT)).toEqual([]);
  });

  it('keputusan untuk run atau izin yang tidak ada diabaikan tanpa galat', async () => {
    await running();

    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN_2,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: false,
    });
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL_2,
      decision: 'allow',
      remember: true,
    });

    expect(rules.list(PROJECT)).toEqual([]);
  });

  it('steer diteruskan ke adapter', async () => {
    const handle = await running();

    coordinator.steer(RUN, 'fokus ke tes saja');

    await until(() => handle.steered.length === 1, 'steer');
    expect(handle.steered).toEqual(['fokus ke tes saja']);
  });

  it('mode follow-up ikut diteruskan ke adapter', async () => {
    const handle = await running();

    coordinator.steer(RUN, 'lalu lint', 'followUp');

    await until(() => handle.steered.length === 1, 'steer');
    expect(handle.steerModes).toEqual(['followUp']);
  });
});

describe('RunCoordinator: batal, batas waktu, dan putus-sambung', () => {
  it('cancel menghentikan adapter dan melapor run.status cancelled; worktree tanpa perubahan dibuang', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter');

    coordinator.cancel(RUN);

    await until(() => types().includes('run.status'), 'cancelled');
    expect(adapter.handle.cancelled).toBe(true);
    expect(events()).toEqual([{ type: 'run.status', status: 'cancelled' }]);
    await until(() => worktrees.get(RUN) === undefined, 'worktree dibuang');
  });

  it('cancel sebelum adapter dimulai membatalkan run tanpa menjalankan omp', async () => {
    coordinator.start(command());
    coordinator.cancel(RUN);

    await until(() => types().includes('run.status'), 'cancelled');

    expect(events()).toEqual([{ type: 'run.status', status: 'cancelled' }]);
    expect(adapter.inputs.length === 0 || adapter.handle.cancelled).toBe(true);
  });

  it('melewati batas waktu: error run_timeout lalu adapter dibatalkan', async () => {
    await build({ maxRunMs: 80 });

    coordinator.start(command());
    await until(() => types().includes('error'), 'timeout');

    expect(events()[0]).toMatchObject({ type: 'error', code: 'run_timeout', retryable: false });
    await until(() => adapter.handle.cancelled, 'adapter dibatalkan');
  });

  it('adapter berhenti tanpa event penutup: error omp_ended_early yang bisa dicoba ulang', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter');

    adapter.handle.events.end();
    await until(() => types().includes('error'), 'error');

    expect(events()[0]).toMatchObject({ code: 'omp_ended_early', retryable: true });
  });

  it('koneksi gateway putus: event ditahan berurutan dan terkirim tepat sekali saat tersambung lagi', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter');
    online = false;

    adapter.handle.events.push({ type: 'message.delta', messageId: MSG, text: 'satu' });
    adapter.handle.events.push({ type: 'message.delta', messageId: MSG, text: 'dua' });
    adapter.handle.events.push({ type: 'run.completed', summary: 'selesai' });
    adapter.handle.events.end();
    await until(() => !coordinator.isWorking(RUN), 'mesin selesai');
    expect(events()).toEqual([]);
    expect(coordinator.activeRunIds).toEqual([RUN]);

    online = true;
    coordinator.flushAll();
    coordinator.flushAll();

    expect(events().map((e) => (e.type === 'message.delta' ? e.text : e.type))).toEqual([
      'satu',
      'dua',
      'run.completed',
    ]);
    await until(() => coordinator.activeRunIds.length === 0, 'run dilepas setelah terkirim');
  });

  it('event besar dipecah supaya setiap frame muat di batas WebSocket gateway', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter');
    const text = 'x'.repeat(40_000);

    adapter.handle.events.push({ type: 'message.delta', messageId: MSG, text });
    adapter.handle.events.push({ type: 'run.completed', summary: 's' });
    adapter.handle.events.end();
    await until(() => types().includes('run.completed'), 'selesai');

    const deltas = events().filter((e) => e.type === 'message.delta');
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.every((e) => JSON.stringify(e).length <= 12_000)).toBe(true);
    expect(deltas.map((e) => (e as { text: string }).text).join('')).toBe(text);
  });
});

describe('RunCoordinator: hasil ditinjau', () => {
  async function finishedWithChange(runId = RUN, summary = 'Tes ditambahkan') {
    coordinator.start(command({ runId }));
    await until(() => adapter.handles.some((h) => h.runId === runId), 'adapter');
    const wt = worktrees.get(runId)!;
    await fs.writeFile(path.join(wt.cwd, 'math.test.js'), "require('node:test');\n");
    const handle = adapter.handles.find((h) => h.runId === runId)!;
    handle.events.push({ type: 'run.completed', summary });
    handle.events.end();
    await until(() => !coordinator.activeRunIds.includes(runId), 'run selesai');
    return wt;
  }

  it('diterima: perubahan di-commit di branch kerja, worktree dibersihkan, branch asli tidak berubah', async () => {
    const wt = await finishedWithChange();
    const mainBefore = git(repo, 'rev-parse', 'main');

    const accepted = await coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN,
      decision: 'accept',
      comments: [],
      merge: false,
    });

    expect(accepted.ok).toBe(true);
    await expect(fs.stat(wt.top)).rejects.toThrow();
    expect(git(repo, 'log', '-1', '--format=%s', wt.branch)).toBe('test: tes ditambahkan');
    expect(git(repo, 'ls-tree', '-r', '--name-only', wt.branch)).toContain('math.test.js');
    expect(git(repo, 'rev-parse', 'main')).toBe(mainBefore);
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    await expect(fs.stat(path.join(repo, 'math.test.js'))).rejects.toThrow();
  });

  it('ditolak: worktree dan branch dihapus, repo asli tidak berubah', async () => {
    const wt = await finishedWithChange();
    const mainBefore = git(repo, 'rev-parse', 'main');

    const rejected = await coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN,
      decision: 'reject',
      comments: [],
      merge: false,
    });

    expect(rejected.ok).toBe(true);
    await expect(fs.stat(wt.top)).rejects.toThrow();
    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');
    expect(git(repo, 'rev-parse', 'main')).toBe(mainBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('meninjau run yang tidak punya worktree tidak melempar', async () => {
    await expect(
      coordinator.reviewApply({
        type: 'review.apply',
        runId: RUN_2,
        decision: 'reject',
        comments: [],
        merge: false,
      }),
    ).resolves.toMatchObject({ ok: true, decision: 'reject' });
  });

  it('dua run paralel punya branch dan worktree sendiri; menolak satu tidak mengganggu yang lain', async () => {
    const a = await finishedWithChange(RUN, 'A');
    const b = await finishedWithChange(RUN_2, 'B');
    expect(a.top).not.toBe(b.top);

    await coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN,
      decision: 'reject',
      comments: [],
      merge: false,
    });

    await expect(fs.stat(b.top)).resolves.toBeDefined();
    expect(git(repo, 'branch', '--list', 'aios/*')).toContain(b.branch);
    expect(git(repo, 'branch', '--list', 'aios/*')).not.toContain(a.branch);
  });
});

describe('RunCoordinator: mode in_place (langsung di branch aktif)', () => {
  const inPlace = (over: Partial<StartCommand> = {}) => {
    const cmd = command(over);
    delete cmd.workspace; // kosong = setelan project (bawaan in_place)
    return cmd;
  };
  const readyEvents = (runId = RUN) =>
    sent.filter((s) => s.runId === runId && s.event.type === 'workspace.ready').map((s) => s.event);
  const review = (runId: string, decision: 'accept' | 'reject') =>
    coordinator.reviewApply({ type: 'review.apply', runId, decision, comments: [], merge: false });

  it('bawaan: agent bekerja di folder project pada branch aktif; terima = commit di main, tanpa branch aios', async () => {
    const head = git(repo, 'rev-parse', 'HEAD');
    coordinator.start(inPlace());
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');

    expect(adapter.inputs[0]?.cwd).toBe(repo);
    expect(adapter.inputs[0]?.systemPrompt).toContain('# Folder kerja');
    expect(readyEvents()).toEqual([
      { type: 'workspace.ready', mode: 'in_place', branch: 'main', base: head },
    ]);
    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');

    await fs.writeFile(path.join(repo, 'math.test.js'), "require('node:test');\n");
    adapter.handle.events.push({ type: 'run.completed', summary: 'Tes ditambahkan' });
    adapter.handle.events.end();
    await until(() => !coordinator.activeRunIds.includes(RUN), 'run selesai');
    expect(types()).toEqual(['diff.updated', 'run.completed']);

    const accepted = await review(RUN, 'accept');

    expect(accepted).toMatchObject({ ok: true, branch: 'main', merged: false });
    expect(git(repo, 'rev-parse', 'main~1')).toBe(head);
    expect(git(repo, 'rev-parse', 'main')).toBe(accepted.commit);
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('test: tes ditambahkan');
    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('setelan project `worktree` dipakai bila run tidak memilih', async () => {
    const setup = new ProjectSetupStore(path.join(base, 'data', 'setup.json'));
    await setup.set(PROJECT, {
      commands: [],
      linkNodeModules: false,
      lsp: true,
      workspace: 'worktree',
    });
    await build({ setup });
    coordinator.start(inPlace());
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');

    expect(adapter.inputs[0]?.cwd).not.toBe(repo);
    expect(readyEvents()[0]).toMatchObject({ mode: 'worktree', branch: workerBranchFor(RUN) });
  });

  it('folder kotor: run ditolak dengan workspace_dirty dan jalan keluar, adapter tidak dimulai', async () => {
    await fs.writeFile(path.join(repo, 'math.js'), 'diubah pemilik\n');

    coordinator.start(inPlace());
    await until(() => types().includes('error'), 'error');

    expect(events()[0]).toMatchObject({
      type: 'error',
      code: 'workspace_dirty',
      message: expect.stringContaining('worktree terpisah') as string,
    });
    expect(adapter.inputs).toHaveLength(0);
    expect(worktrees.get(RUN)).toBeUndefined();
    expect(await fs.readFile(path.join(repo, 'math.js'), 'utf8')).toBe('diubah pemilik\n');
  });

  it('pertanyaan baca saja tidak mengunci repo; penulis kedua ditolak otomatis dengan alasan; pembaca dilepas tanpa tinjauan', async () => {
    coordinator.start(inPlace());
    await until(() => adapter.handles.length === 1, 'run A dimulai');
    const reader = adapter.handle;
    // A belum meminta izin tulis: B boleh berjalan di folder yang sama (dulu workspace_busy, uji project 4f).
    coordinator.start(inPlace({ runId: RUN_2 }));
    await until(() => adapter.handles.length === 2, 'run B dimulai');
    const writer = adapter.handle;
    writer.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'file_write',
      detail: 'Path: math.test.js\nContent:\nx',
    });
    await until(() => types(RUN_2).includes('approval.requested'), 'izin B ditanyakan');
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN_2,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: false,
    });
    expect(writer.resolved).toEqual([[APPROVAL, 'allow', false]]);

    // B kini penulis: A meminta tulis dan ditolak tanpa bertanya, dengan penjelasan sekali ke agent dan alasan yang
    // tampil di langkah tool-nya (bukan sekadar "denied by user" dari omp).
    reader.events.push({ type: 'tool.started', toolCallId: 'tool-a', name: 'bash' });
    reader.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'command',
      detail: 'npm install',
      toolCallId: 'tool-a',
    });
    await until(() => reader.resolved.length === 1, 'A ditolak otomatis');
    expect(reader.resolved[0]).toEqual([APPROVAL_2, 'deny', undefined]);
    expect(reader.steered).toHaveLength(1);
    expect(types(RUN)).not.toContain('approval.requested');
    reader.events.push({
      type: 'tool.finished',
      toolCallId: 'tool-a',
      status: 'error',
      durationMs: 1,
    });
    await until(() => types(RUN).includes('tool.finished'), 'langkah A selesai');
    expect(types(RUN).slice(-2)).toEqual(['tool.output', 'tool.finished']);
    expect(events(RUN).find((e) => e.type === 'tool.output')).toMatchObject({
      toolCallId: 'tool-a',
      stream: 'stderr',
      chunk: expect.stringContaining('run lain sedang mengubah folder project') as string,
    });

    await fs.writeFile(path.join(repo, 'math.test.js'), "require('node:test');\n");
    // A selesai: perubahan di folder milik B, jadi A tidak membuat diff dan tidak menunggu tinjauan.
    reader.events.push({ type: 'run.completed', summary: 'Penjelasan' });
    reader.events.end();
    await until(() => worktrees.get(RUN) === undefined, 'A dilepas');
    expect(types(RUN)).not.toContain('diff.updated');
    expect(await fs.readFile(path.join(repo, 'math.test.js'), 'utf8')).toContain('node:test');

    writer.events.push({ type: 'run.completed', summary: 'Tes ditambahkan' });
    writer.events.end();
    await until(() => !coordinator.activeRunIds.includes(RUN_2), 'B selesai');
    expect(types(RUN_2)).toContain('diff.updated');
    expect(worktrees.get(RUN_2)).toBeDefined();
  });

  it('izin tulis yang menunggu tidak mengunci repo; yang lebih dulu diizinkan menjadi penulis, izin run lain yang menunggu ditolak otomatis', async () => {
    coordinator.start(inPlace());
    await until(() => adapter.handles.length === 1, 'run A dimulai');
    const a = adapter.handle;
    a.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'npm install',
      toolCallId: 'tool-a',
    });
    await until(() => types().includes('approval.requested'), 'izin A ditanyakan');

    // Uji project N6: dulu izin yang baru DIMINTA sudah mengunci repo, jadi run lain ditolak workspace_busy atau
    // penulisannya ditolak diam-diam lalu berakhir "Selesai" tanpa perubahan.
    coordinator.start(inPlace({ runId: RUN_2 }));
    await until(() => adapter.handles.length === 2, 'B dimulai walau izin A menunggu');
    const b = adapter.handle;
    b.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'file_write',
      detail: 'Path: math.test.js\nContent:\nx',
    });
    await until(() => types(RUN_2).includes('approval.requested'), 'izin B ditanyakan');
    expect(b.resolved).toEqual([]);

    // B diizinkan lebih dulu dan menjadi penulis. Izin A yang menunggu tidak akan pernah bisa diberikan: ditolak
    // sekarang, penolakannya diteruskan (panel izin tertutup), agent diberi tahu, dan langkahnya diberi alasan.
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN_2,
      approvalId: APPROVAL_2,
      decision: 'allow',
      remember: false,
    });
    await until(() => a.resolved.length === 1, 'izin A ditolak otomatis');
    expect(a.resolved[0]).toEqual([APPROVAL, 'deny', undefined]);
    await until(() => types().includes('approval.resolved'), 'penolakan A diteruskan');
    expect(a.steered).toHaveLength(1);
    a.events.push({ type: 'tool.finished', toolCallId: 'tool-a', status: 'error', durationMs: 1 });
    await until(() => types().includes('tool.finished'), 'langkah A selesai');
    expect(types().slice(-2)).toEqual(['tool.output', 'tool.finished']);

    // B penulis yang berjalan: run in_place ketiga ditolak workspace_busy.
    const third = '0192f0c4-7a1b-7c2d-aaaa-4a5b6c7d8e92';
    coordinator.start(inPlace({ runId: third }));
    await until(() => types(third).includes('error'), 'run ketiga ditolak');
    expect(events(third)[0]).toMatchObject({ type: 'error', code: 'workspace_busy' });
  });

  it('izin tulis yang ditolak pemilik tidak mengunci repo; run lain bisa mulai tanpa menunggu run ini selesai', async () => {
    coordinator.start(inPlace());
    await until(() => adapter.handles.length === 1, 'run A dimulai');
    adapter.handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'npm install',
    });
    await until(() => types().includes('approval.requested'), 'izin A ditanyakan');
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'deny',
      remember: false,
    });
    const third = '0192f0c4-7a1b-7c2d-aaaa-4a5b6c7d8e92';
    coordinator.start(inPlace({ runId: third }));
    await until(() => adapter.handles.length === 2, 'run ketiga dimulai walau A masih berjalan');
    expect(coordinator.activeRunIds).toContain(RUN);
  });

  it('izin tulis yang diizinkan tetap memegang kunci sampai run selesai', async () => {
    coordinator.start(inPlace());
    await until(() => adapter.handles.length === 1, 'run A dimulai');
    adapter.handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'npm install',
    });
    await until(() => types().includes('approval.requested'), 'izin A ditanyakan');
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: false,
    });
    // Izin tulis kedua ditolak: A sudah pernah boleh menulis, jadi kunci tetap dipegang.
    adapter.handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'command',
      detail: 'npm run build',
    });
    await until(() => types().filter((t) => t === 'approval.requested').length === 2, 'izin kedua');
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL_2,
      decision: 'deny',
      remember: false,
    });
    coordinator.start(inPlace({ runId: RUN_2 }));
    await until(() => types(RUN_2).includes('error'), 'B ditolak');
    expect(events(RUN_2)[0]).toMatchObject({ type: 'error', code: 'workspace_busy' });
  });

  it('dihentikan dengan perubahan: diff terakhir sebelum cancelled, tetap bisa ditinjau, dilaporkan ke gateway', async () => {
    const reported: { runId: string; files: { path: string }[] }[][] = [];
    await build({
      reportPending: (runs) => {
        reported.push(runs);
        return true;
      },
    });
    coordinator.start(inPlace());
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');
    await fs.writeFile(path.join(repo, 'setengah.js'), 'setengah jadi\n');

    coordinator.cancel(RUN);
    await until(() => !coordinator.activeRunIds.includes(RUN), 'run dilepas');

    expect(types()).toEqual(['diff.updated', 'run.status']);
    expect(events()[0]).toMatchObject({ files: [{ path: 'setengah.js' }] });
    expect(worktrees.state(RUN)).toBe('review');
    expect(reported.at(-1)).toMatchObject([{ runId: RUN, files: [{ path: 'setengah.js' }] }]);

    // Laporan diulang saat tersambung lagi.
    await coordinator.reportPending();
    expect(reported).toHaveLength(2);

    const rejected = await review(RUN, 'reject');
    expect(rejected.ok).toBe(true);
    await expect(fs.stat(path.join(repo, 'setengah.js'))).rejects.toThrow();
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('perintah git yang memindahkan HEAD ditolak worker, walau ada aturan "selalu"', async () => {
    await rules.add(PROJECT, 'command', 'git commit -am x');
    coordinator.start(inPlace());
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');

    adapter.handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'git commit -am x',
    });
    await until(() => adapter.handle.resolved.length === 1, 'dijawab');

    expect(adapter.handle.resolved[0]).toEqual([APPROVAL, 'deny', undefined]);
    expect(types()).not.toContain('approval.requested');
  });

  it('mode rencana: folder kotor boleh, tanpa checkpoint dan diff, folder kerja dilepas tanpa menyentuh berkas', async () => {
    await fs.writeFile(path.join(repo, 'math.js'), 'diubah pemilik\n');
    coordinator.start(inPlace({ planOnly: true }));
    await until(() => adapter.inputs.length === 1, 'adapter dimulai');
    expect(adapter.inputs[0]?.cwd).toBe(repo);

    adapter.handle.events.push({ type: 'tool.started', toolCallId: 't1', name: 'read' });
    adapter.handle.events.push({
      type: 'tool.finished',
      toolCallId: 't1',
      status: 'ok',
      durationMs: 1,
    });
    adapter.handle.events.push({ type: 'run.completed', summary: 'Rencana.' });
    adapter.handle.events.end();
    await until(() => !coordinator.activeRunIds.includes(RUN), 'run selesai');

    expect(types()).not.toContain('diff.updated');
    expect(types()).not.toContain('checkpoint.created');
    expect(worktrees.get(RUN)).toBeUndefined();
    expect(await fs.readFile(path.join(repo, 'math.js'), 'utf8')).toBe('diubah pemilik\n');
  });

  it('pesan lanjutan melanjutkan folder in_place yang menunggu tinjauan; diff tetap terhadap base awal', async () => {
    const head = git(repo, 'rev-parse', 'HEAD');
    coordinator.start(inPlace());
    await until(() => adapter.inputs.length === 1, 'run pertama');
    await fs.writeFile(path.join(repo, 'a.txt'), 'satu\n');
    adapter.handle.events.push({ type: 'run.completed', summary: 'satu' });
    adapter.handle.events.end();
    await until(() => !coordinator.activeRunIds.includes(RUN), 'run pertama selesai');

    coordinator.start(inPlace({ runId: RUN_2, continueFromRunId: RUN }));
    await until(() => adapter.inputs.length === 2, 'run lanjutan');

    expect(adapter.inputs[1]?.cwd).toBe(repo);
    expect(readyEvents(RUN_2)).toEqual([
      { type: 'workspace.ready', mode: 'in_place', branch: 'main', base: head },
    ]);
    await fs.writeFile(path.join(repo, 'b.txt'), 'dua\n');
    adapter.handle.events.push({ type: 'run.completed', summary: 'dua' });
    adapter.handle.events.end();
    await until(() => !coordinator.activeRunIds.includes(RUN_2), 'run lanjutan selesai');
    expect(events(RUN_2).find((e) => e.type === 'diff.updated')).toMatchObject({
      files: [{ path: 'a.txt' }, { path: 'b.txt' }],
    });
    expect(worktrees.get(RUN)).toBeUndefined();
  });
});

describe('RunCoordinator: skill katalog', () => {
  const skill = {
    id: 'ui-baseline',
    description: 'Saat menata UI.',
    checksum: 'a'.repeat(64),
    body: 'isi skill',
  };
  const withIndex = (ids: string[]) =>
    command({ bundle: { role: 'frontend', systemPrompt: '# Skill tersedia', skillIds: ids } });

  it('skill yang ditawarkan diselesaikan lewat katalog lalu diteruskan ke adapter', async () => {
    const resolved: string[][] = [];
    await build({
      skills: {
        resolve: (ids) => {
          resolved.push([...ids]);
          return Promise.resolve([skill]);
        },
      },
    });
    coordinator.start(withIndex(['ui-baseline']));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');

    expect(resolved).toEqual([['ui-baseline']]);
    expect(adapter.inputs[0]!.skills).toEqual([skill]);
    expect(adapter.inputs[0]!.skillIds).toEqual(['ui-baseline']);
    adapter.handle.events.end();
  });

  it('read skill://<id> yang ada di indeks dilaporkan sebagai openedSkills sebelum penutup; id luar indeks diabaikan', async () => {
    await build({ skills: { resolve: () => Promise.resolve([skill]) } });
    coordinator.start(withIndex(['ui-baseline']));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;

    handle.events.push({
      type: 'tool.started',
      toolCallId: 's1',
      name: 'read',
      target: 'skill://ui-baseline',
    });
    handle.events.push({
      type: 'tool.started',
      toolCallId: 's2',
      name: 'read',
      target: 'skill://skill-hantu',
    });
    handle.events.push({
      type: 'tool.started',
      toolCallId: 's3',
      name: 'read',
      target: 'src/a.ts',
    });
    handle.events.push({ type: 'run.completed', summary: 'selesai' });
    await until(() => types().includes('run.completed'), 'penutup');

    const used = events().filter((e) => e.type === 'context.used');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ openedSkills: ['ui-baseline'], engine: 'omp' });
    expect(types().indexOf('context.used')).toBeLessThan(types().indexOf('run.completed'));
    handle.events.end();
  });

  it('tanpa pembukaan skill tidak ada context.used dari worker', async () => {
    await build({ skills: { resolve: () => Promise.resolve([skill]) } });
    coordinator.start(withIndex(['ui-baseline']));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    adapter.handle.events.push({ type: 'run.completed', summary: 'selesai' });
    await until(() => types().includes('run.completed'), 'penutup');
    expect(types()).not.toContain('context.used');
    adapter.handle.events.end();
  });

  it('katalog gagal dimuat: run tetap berjalan tanpa skill (tidak menggagalkan run coding)', async () => {
    await build({ skills: { resolve: () => Promise.reject(new Error('gateway offline')) } });
    coordinator.start(withIndex(['ui-baseline']));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    expect(adapter.inputs[0]!.skills).toEqual([]);
    adapter.handle.events.end();
  });
});

describe('RunCoordinator: checkpoint, diff, dan run lanjutan', () => {
  it('setiap langkah yang mengubah berkas membuat checkpoint dan memperbarui diff; langkah tanpa perubahan tidak', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;
    const wt = worktrees.get(RUN)!;

    handle.events.push({ type: 'tool.started', toolCallId: 'c1', name: 'write', target: 'a.txt' });
    await fs.writeFile(path.join(wt.cwd, 'a.txt'), 'satu');
    handle.events.push({ type: 'tool.finished', toolCallId: 'c1', status: 'ok', durationMs: 5 });
    handle.events.push({ type: 'tool.started', toolCallId: 'c2', name: 'read', target: 'a.txt' });
    handle.events.push({ type: 'tool.finished', toolCallId: 'c2', status: 'ok', durationMs: 1 });
    await until(() => types().filter((x) => x === 'tool.finished').length === 2, 'dua langkah');
    await until(() => coordinator.isWorking(RUN) && types().includes('diff.updated'), 'diff');

    expect(types()).toEqual([
      'tool.started',
      'tool.finished',
      'checkpoint.created',
      'diff.updated',
      'tool.started',
      'tool.finished',
    ]);
    expect(events().find((e) => e.type === 'checkpoint.created')).toMatchObject({
      label: 'write a.txt',
    });
    expect(events().find((e) => e.type === 'diff.updated')).toMatchObject({
      files: [{ path: 'a.txt', additions: 1, deletions: 0 }],
    });
    expect((await review.get(RUN)).checkpoints).toHaveLength(1);
    handle.events.end();
  });

  it('run lanjutan memakai worktree run sebelumnya; hasil review pertama tidak diulang saat perintah sama datang lagi', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const first = worktrees.get(RUN)!;
    await fs.writeFile(path.join(first.cwd, 'a.txt'), 'satu');
    adapter.handle.events.push({ type: 'run.completed', summary: 'Selesai' });
    adapter.handle.events.end();
    await until(() => coordinator.activeRunIds.length === 0, 'run pertama dilepas');

    coordinator.start(
      command({ runId: RUN_2, continueFromRunId: RUN, prompt: 'perbaiki a.txt baris 1' }),
    );
    await until(() => adapter.handles.length === 2, 'run lanjutan dimulai');

    const second = worktrees.get(RUN_2)!;
    expect(second.top).toBe(first.top);
    expect(second.branch).toBe(first.branch);
    expect(adapter.inputs[1]?.cwd).toBe(first.cwd);
    expect(adapter.inputs[1]?.prompt).toBe('perbaiki a.txt baris 1');
    expect(worktrees.get(RUN)).toBeUndefined();
    adapter.handles[1]?.events.end();
    await until(() => coordinator.activeRunIds.length === 0, 'run lanjutan dilepas');

    const accept: Parameters<typeof coordinator.reviewApply>[0] = {
      type: 'review.apply',
      runId: RUN_2,
      decision: 'accept',
      comments: [],
      merge: false,
    };
    const a = await coordinator.reviewApply(accept);
    const b = await coordinator.reviewApply(accept);
    expect(a.ok).toBe(true);
    expect(b).toBe(a);
  });

  it('run lanjutan tanpa worktree sebelumnya gagal dengan alasan jelas', async () => {
    coordinator.start(command({ runId: RUN_2, continueFromRunId: RUN }));
    await until(() => types(RUN_2).includes('error'), 'galat');

    expect(events(RUN_2)[0]).toMatchObject({ code: 'worktree_failed' });
  });
});

describe('RunCoordinator: tool gateway (aios_tools)', () => {
  const registered: string[] = [];
  const released: string[] = [];
  const tools = {
    register: (runId: string) => {
      registered.push(runId);
      return Promise.resolve({
        url: `http://127.0.0.1:1/mcp/${runId}`,
        headers: { Authorization: 'Bearer lokal-per-run' },
        unregister: () => released.push(runId),
      });
    },
    registerConnector: (runId: string, connectorId: string) => {
      registered.push(`${runId}/${connectorId}`);
      return Promise.resolve({
        url: `http://127.0.0.1:1/mcp/${runId}/konektor/${connectorId}`,
        headers: { Authorization: `Bearer lokal-${connectorId}` },
        unregister: () => released.push(`${runId}/${connectorId}`),
      });
    },
  };
  const ask = (approvalId: string, tool: string, args: string) => ({
    type: 'approval.requested' as const,
    approvalId,
    kind: 'network' as const,
    detail: `${tool}\nArguments:\n${args}`,
  });

  beforeEach(async () => {
    registered.length = 0;
    released.length = 0;
    await build({ tools });
  });

  it('gatewayTools: relay didaftarkan, server aios_tools dan instruksi ikut ke omp, dilepas saat run selesai', async () => {
    coordinator.start(command({ gatewayTools: true }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');

    expect(registered).toEqual([RUN]);
    expect(adapter.inputs[0]?.mcpServers).toEqual({
      aios_tools: {
        url: `http://127.0.0.1:1/mcp/${RUN}`,
        headers: { Authorization: 'Bearer lokal-per-run' },
      },
    });
    expect(adapter.inputs[0]?.systemPrompt).toContain('# Tool web');

    adapter.handle.events.push({ type: 'run.completed', summary: 'selesai' });
    adapter.handle.events.end();
    await until(() => coordinator.activeRunIds.length === 0, 'run dilepas');
    expect(released).toEqual([RUN]);
  });

  it('tanpa gatewayTools (gateway mematikan fitur): tidak ada relay, server MCP, atau instruksi', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter dimulai');

    expect(registered).toEqual([]);
    expect(adapter.inputs[0]?.mcpServers).toBeUndefined();
    expect(adapter.inputs[0]?.systemPrompt).not.toContain('# Tool web');
  });

  it('izin web ditanyakan; "selalu" diingat per nama tool untuk project ini, bukan per argumen', async () => {
    coordinator.start(command({ gatewayTools: true }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;

    handle.events.push(ask(APPROVAL, 'mcp__aios_tools_web_search', '{"query":"vite 7"}'));
    await until(() => types().includes('approval.requested'), 'permintaan izin');
    expect(handle.resolved).toEqual([]);
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: true,
    });
    await until(() => handle.resolved.length === 1, 'dijawab');
    expect(rules.list(PROJECT)).toEqual([
      { projectId: PROJECT, kind: 'network', pattern: 'mcp__aios_tools_web_search' },
    ]);
    const before = types().filter((t) => t === 'approval.requested').length;

    // Kueri lain dengan tool yang sama dijawab otomatis; web_read tetap ditanyakan.
    handle.events.push(ask(APPROVAL_2, 'mcp__aios_tools_web_search', '{"query":"lain"}'));
    await until(() => handle.resolved.length === 2, 'dijawab otomatis');
    expect(handle.resolved[1]).toEqual([APPROVAL_2, 'allow', undefined]);
    const third = '0192f0c4-7a1b-7c2d-a005-4a5b6c7d8e95';
    handle.events.push(ask(third, 'mcp__aios_tools_web_read', '{"url":"https://vite.dev/"}'));
    await until(
      () => types().filter((t) => t === 'approval.requested').length === before + 1,
      'web_read ditanyakan',
    );
    expect(handle.resolved).toHaveLength(2);
    // Aturan per nama tool hanya untuk tool gateway; perintah lain tetap cocok persis.
    expect(rules.matches(PROJECT, 'network', 'mcp__aios_tools_web_search\nArguments:\n{}')).toBe(
      true,
    );
    expect(rules.matches(PROJECT, 'network', 'mcp__aios_tools_web_read\nArguments:\n{}')).toBe(
      false,
    );
  });

  it('mode rencana: tool web gateway tetap ditanyakan (hanya membaca), izin lain tetap ditolak otomatis', async () => {
    coordinator.start(command({ gatewayTools: true, planOnly: true }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;

    handle.events.push(ask(APPROVAL, 'mcp__aios_tools_web_search', '{"query":"vite"}'));
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'command',
      detail: 'node --test',
    });
    await until(() => handle.resolved.length === 1, 'perintah ditolak');
    await until(() => types().includes('approval.requested'), 'web ditanyakan');

    expect(handle.resolved).toEqual([[APPROVAL_2, 'deny', undefined]]);
    expect(events().filter((e) => e.type === 'approval.requested')).toEqual([
      expect.objectContaining({ approvalId: APPROVAL, kind: 'network' }),
    ]);
  });

  it('tool data gateway diizinkan diam-diam, juga di mode rencana; nama lain tetap ditolak', async () => {
    coordinator.start(command({ gatewayTools: true, planOnly: true }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;
    const names = ['memory_list', 'space_search', 'task_list', 'schedule_list'];
    const ids = names.map((_, i) => `0192f0c4-7a1b-7c2d-a006-4a5b6c7d8e9${i}`);
    names.forEach((name, i) =>
      handle.events.push({
        type: 'approval.requested',
        approvalId: ids[i]!,
        kind: 'command',
        detail: `mcp__aios_tools_${name}\nArguments:\n{}`,
      }),
    );
    // Nama mirip di luar daftar tool data tetap ditolak mode rencana.
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'command',
      detail: 'mcp__aios_tools_memory_delete\nArguments:\n{}',
    });
    await until(() => handle.resolved.length === names.length + 1, 'semua dijawab');

    expect(handle.resolved).toEqual([
      ...ids.map((id) => [id, 'allow', undefined]),
      [APPROVAL_2, 'deny', undefined],
    ]);
    expect(types()).not.toContain('approval.requested');
    expect(rules.list(PROJECT)).toEqual([]);
  });

  it('tool usulan diizinkan diam-diam (hanya membuat usulan yang menunggu pemilik)', async () => {
    coordinator.start(command({ gatewayTools: true }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;
    const names = ['memory_propose', 'task_propose', 'schedule_propose'];
    const ids = names.map((_, i) => `0192f0c4-7a1b-7c2d-a007-4a5b6c7d8e9${i}`);
    names.forEach((name, i) =>
      handle.events.push({
        type: 'approval.requested',
        approvalId: ids[i]!,
        kind: 'command',
        detail: `mcp__aios_tools_${name}\nArguments:\n{"title":"x"}`,
      }),
    );
    await until(() => handle.resolved.length === names.length, 'semua dijawab');

    expect(handle.resolved).toEqual(ids.map((id) => [id, 'allow', undefined]));
    expect(types()).not.toContain('approval.requested');
    expect(rules.list(PROJECT)).toEqual([]);
  });

  it('mode rencana: tool usulan ditolak tanpa bertanya, tool data tetap boleh', async () => {
    coordinator.start(command({ gatewayTools: true, planOnly: true }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'mcp__aios_tools_task_propose\nArguments:\n{"title":"x"}',
    });
    handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL_2,
      kind: 'command',
      detail: 'mcp__aios_tools_task_list\nArguments:\n{}',
    });
    await until(() => handle.resolved.length === 2, 'keduanya dijawab');

    expect(handle.resolved).toEqual([
      [APPROVAL, 'deny', undefined],
      [APPROVAL_2, 'allow', undefined],
    ]);
    expect(types()).not.toContain('approval.requested');
  });

  it('tanpa gatewayTools nama tool usulan tidak dipercaya: tetap ditanyakan', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    adapter.handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'mcp__aios_tools_schedule_propose\nArguments:\n{}',
    });
    await until(() => types().includes('approval.requested'), 'ditanyakan');
    expect(adapter.handle.resolved).toEqual([]);
  });

  it('tanpa gatewayTools nama tool data tidak dipercaya: tetap ditanyakan', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    adapter.handle.events.push({
      type: 'approval.requested',
      approvalId: APPROVAL,
      kind: 'command',
      detail: 'mcp__aios_tools_task_list\nArguments:\n{}',
    });
    await until(() => types().includes('approval.requested'), 'ditanyakan');
    expect(adapter.handle.resolved).toEqual([]);
  });
});

describe('RunCoordinator: konektor MCP', () => {
  const registered: string[] = [];
  const released: string[] = [];
  const tools = {
    register: (runId: string) => {
      registered.push(runId);
      return Promise.resolve({
        url: `http://127.0.0.1:1/mcp/${runId}`,
        headers: { Authorization: 'Bearer lokal-per-run' },
        unregister: () => released.push(runId),
      });
    },
    registerConnector: (runId: string, connectorId: string) => {
      registered.push(`${runId}/${connectorId}`);
      return Promise.resolve({
        url: `http://127.0.0.1:1/mcp/${runId}/konektor/${connectorId}`,
        headers: { Authorization: `Bearer lokal-${connectorId}` },
        unregister: () => released.push(`${runId}/${connectorId}`),
      });
    },
  };
  const konektor = [
    { id: 'k1', name: 'github', displayName: 'GitHub pemilik' },
    { id: 'k2', name: 'linear', displayName: 'Linear' },
  ];
  const ask = (approvalId: string, tool: string, args: string) => ({
    type: 'approval.requested' as const,
    approvalId,
    kind: 'network' as const,
    detail: `${tool}\nArguments:\n${args}`,
  });

  beforeEach(async () => {
    registered.length = 0;
    released.length = 0;
    await build({ tools });
  });

  it('satu titik relay per konektor, server konektor_<slug> dan instruksi ikut ke omp, dilepas saat run selesai', async () => {
    coordinator.start(command({ connectors: konektor }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');

    expect(registered).toEqual([`${RUN}/k1`, `${RUN}/k2`]);
    expect(adapter.inputs[0]?.mcpServers).toEqual({
      konektor_github: {
        url: `http://127.0.0.1:1/mcp/${RUN}/konektor/k1`,
        headers: { Authorization: 'Bearer lokal-k1' },
      },
      konektor_linear: {
        url: `http://127.0.0.1:1/mcp/${RUN}/konektor/k2`,
        headers: { Authorization: 'Bearer lokal-k2' },
      },
    });
    const prompt = adapter.inputs[0]?.systemPrompt ?? '';
    expect(prompt).toContain('# Konektor');
    expect(prompt).toContain('GitHub pemilik, Linear');
    expect(prompt).not.toContain('# Tool web');

    adapter.handle.events.push({ type: 'run.completed', summary: 'selesai' });
    adapter.handle.events.end();
    await until(() => coordinator.activeRunIds.length === 0, 'run dilepas');
    expect(released).toEqual([`${RUN}/k1`, `${RUN}/k2`]);
  });

  it('tanpa konektor aktif: tidak ada pendaftaran, server MCP, atau instruksi konektor', async () => {
    coordinator.start(command());
    await until(() => adapter.handles.length === 1, 'adapter dimulai');

    expect(registered).toEqual([]);
    expect(adapter.inputs[0]?.mcpServers).toBeUndefined();
    expect(adapter.inputs[0]?.systemPrompt).not.toContain('# Konektor');
  });

  it('izin konektor ditanyakan; "selalu" diingat per nama tool, bukan per argumen', async () => {
    coordinator.start(command({ connectors: konektor }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;

    handle.events.push(ask(APPROVAL, 'mcp__konektor_github_create_issue', '{"title":"bug"}'));
    await until(() => types().includes('approval.requested'), 'permintaan izin');
    expect(handle.resolved).toEqual([]);
    await coordinator.resolveApproval({
      type: 'approval.resolve',
      runId: RUN,
      approvalId: APPROVAL,
      decision: 'allow',
      remember: true,
    });
    await until(() => handle.resolved.length === 1, 'dijawab');
    expect(rules.list(PROJECT)).toEqual([
      { projectId: PROJECT, kind: 'network', pattern: 'mcp__konektor_github_create_issue' },
    ]);

    // Argumen lain untuk tool yang sama dijawab otomatis; tool lain tetap ditanyakan.
    const before = types().filter((t) => t === 'approval.requested').length;
    handle.events.push(ask(APPROVAL_2, 'mcp__konektor_github_create_issue', '{"title":"lain"}'));
    await until(() => handle.resolved.length === 2, 'dijawab otomatis');
    expect(handle.resolved[1]).toEqual([APPROVAL_2, 'allow', undefined]);
    const ketiga = '0192f0c4-7a1b-7c2d-a005-4a5b6c7d8e95';
    handle.events.push(ask(ketiga, 'mcp__konektor_linear_create_issue', '{"title":"bug"}'));
    await until(
      () => types().filter((t) => t === 'approval.requested').length === before + 1,
      'konektor lain ditanyakan',
    );
  });

  it('tautan dari pesan pemilik tidak membuat tool konektor diizinkan diam-diam', async () => {
    coordinator.start(
      command({ connectors: konektor, prompt: 'lihat https://contoh.test/a lalu buat isu' }),
    );
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;

    handle.events.push(
      ask(APPROVAL, 'mcp__konektor_github_create_issue', '{"url":"https://contoh.test/a"}'),
    );
    await until(() => types().includes('approval.requested'), 'ditanyakan');
    expect(handle.resolved).toEqual([]);
  });

  it('mode rencana: tool konektor ditolak tanpa bertanya (gateway yang tahu baca atau tulis)', async () => {
    coordinator.start(command({ connectors: konektor, planOnly: true }));
    await until(() => adapter.handles.length === 1, 'adapter dimulai');
    const handle = adapter.handle;

    handle.events.push(ask(APPROVAL, 'mcp__konektor_github_search_issues', '{"q":"bug"}'));
    handle.events.push(ask(APPROVAL_2, 'mcp__konektor_github_create_issue', '{"title":"bug"}'));
    await until(() => handle.resolved.length === 2, 'keduanya dijawab');

    expect(handle.resolved.map((r) => r[1])).toEqual(['deny', 'deny']);
    expect(types()).not.toContain('approval.requested');
  });
});
describe('writeTargetsInside', () => {
  it('target di folder run diterima; .git (termasuk varian huruf, titik akhir, symlink) dan luar folder ditolak', async () => {
    await fs.mkdir(path.join(repo, 'src'), { recursive: true });
    await fs.symlink(path.join(repo, '.git'), path.join(repo, 'tautan'));
    const write = (target: string) => writeTargetsInside(`Path: ${target}\nContent:\nisi`, repo);

    expect(await write('src/a.ts')).toBe(true);
    expect(await writeTargetsInside('File: src/a.ts\nFile: math.js', repo)).toBe(true);
    for (const target of [
      '.git/config',
      '.GIT/config',
      '.git./config',
      'src/../.git/hooks/pre-commit',
      'tautan/config',
      '../luar.txt',
      '/etc/passwd',
    ]) {
      expect(await write(target), target).toBe(false);
    }
  });

  it('detail yang dipotong sebelum Content: (daftar target bisa tidak lengkap) ditolak', async () => {
    const files = Array.from({ length: 400 }, (_, i) => `File: src/berkas-${i}.ts`).join('\n');
    const clipped = `${files.slice(0, APPROVAL_DETAIL_MAX - 1)}…`;
    expect(await writeTargetsInside(clipped, repo)).toBe(false);
    // Dipotong di dalam isi berkas: daftar target utuh, jadi tetap dinilai.
    const big = `Path: src/besar.ts\nContent:\n${'x'.repeat(APPROVAL_DETAIL_MAX)}`;
    expect(await writeTargetsInside(`${big.slice(0, APPROVAL_DETAIL_MAX - 1)}…`, repo)).toBe(true);
  });
});

vi.setConfig({ testTimeout: 20_000 });
