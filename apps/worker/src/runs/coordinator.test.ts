import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AdapterError,
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
import { RunCoordinator } from './coordinator.js';
import { OmpNotFoundError } from './omp-path.js';
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
  readonly resolved: [string, string, boolean | undefined][] = [];
  cancelled = false;
  constructor(readonly runId: string) {}
  steer(text: string) {
    this.steered.push(text);
    return Promise.resolve();
  }
  cancel() {
    this.cancelled = true;
    this.events.end();
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
  bundle: { role: 'frontend', systemPrompt: '# Peran: Frontend' },
  model: 'combo/code',
  ...over,
});

const events = (runId = RUN) => sent.filter((s) => s.runId === runId).map((s) => s.event);
const types = (runId = RUN) => events(runId).map((e) => e.type);

async function until(check: () => boolean, label: string, ms = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function build(over: { maxRunMs?: number } = {}) {
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
  await until(() => coordinator.activeRunIds.length === 0, 'run dilepas', 3000).catch(
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
    expect(sent).toEqual([]);
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

    await coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN,
      decision: 'accept',
      comments: [],
      merge: false,
    });

    await expect(fs.stat(wt.root)).rejects.toThrow();
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

    await coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN,
      decision: 'reject',
      comments: [],
      merge: false,
    });

    await expect(fs.stat(wt.root)).rejects.toThrow();
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
    expect(a.root).not.toBe(b.root);

    await coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN,
      decision: 'reject',
      comments: [],
      merge: false,
    });

    await expect(fs.stat(b.root)).resolves.toBeDefined();
    expect(git(repo, 'branch', '--list', 'aios/*')).toContain(b.branch);
    expect(git(repo, 'branch', '--list', 'aios/*')).not.toContain(a.branch);
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
    expect(second.root).toBe(first.root);
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

vi.setConfig({ testTimeout: 20_000 });
