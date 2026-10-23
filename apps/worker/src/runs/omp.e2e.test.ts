import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentEvent, WorkerCommand } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVICE, FakeGateway, fresh, until } from '../testing/fake-gateway.js';
import { mockLlm, type ChatRequest, type MockStep } from '../testing/mock-llm.js';
import { startWorker, type RunningWorker } from '../worker.js';
import { resolveOmp } from './omp-path.js';

/**
 * Uji end-to-end dengan omp SUNGGUHAN (dilewati bila omp tidak terpasang, mis. di CI): worker, worktree,
 * proxy LLM, adapter, dan approval, dengan server LLM tiruan di balik "gateway" palsu. Meniru tugas
 * "tambahkan tes untuk fungsi X" di project nyata.
 */
const ompPath = await resolveOmp().catch(() => null);

const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const RUN_1 = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN_2 = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

const TEST_SOURCE = `const test = require('node:test');
const assert = require('node:assert');
const { add } = require('./math.js');
test('add menjumlahkan', () => assert.strictEqual(add(1, 2), 3));
`;

interface RunEvent {
  type: 'run.event';
  runId: string;
  event: AgentEvent;
}

describe.skipIf(ompPath === null)('run coding dengan omp sungguhan', () => {
  let base: string;
  let repo: string;
  let worker: RunningWorker;
  let gateway: FakeGateway;
  let llm: ReturnType<typeof mockLlm>;
  let steps: (toolResults: number, request: ChatRequest) => MockStep;
  let accessToken: string;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      encoding: 'utf8',
    }).trim();

  const eventsOf = (runId: string): AgentEvent[] =>
    gateway.received
      .filter((m): m is RunEvent => (m as { type?: string }).type === 'run.event')
      .filter((m) => m.runId === runId)
      .map((m) => m.event);

  const sendCommand = (command: WorkerCommand) => gateway.last.socket.send(JSON.stringify(command));

  const startCommand = (
    runId: string,
    over: Partial<Extract<WorkerCommand, { type: 'run.start' }>> = {},
  ) =>
    ({
      type: 'run.start',
      runId,
      projectId: PROJECT,
      prompt: 'tambahkan tes untuk fungsi add di math.js',
      bundle: {
        role: 'frontend',
        systemPrompt: '# Peran: Penguji\nTulis tes yang kecil dan jelas.',
      },
      model: 'mock-1',
      ...over,
    }) as WorkerCommand;

  /** Menjawab setiap permintaan izin sampai run selesai; mengembalikan permintaan yang dilihat. */
  function autoAnswer(
    runId: string,
    decide: (event: Extract<AgentEvent, { type: 'approval.requested' }>) => {
      decision: 'allow' | 'deny';
      remember: boolean;
    },
  ) {
    const asked: Extract<AgentEvent, { type: 'approval.requested' }>[] = [];
    const answered = new Set<string>();
    const timer = setInterval(() => {
      for (const event of eventsOf(runId)) {
        if (event.type !== 'approval.requested' || answered.has(event.approvalId)) continue;
        answered.add(event.approvalId);
        asked.push(event);
        sendCommand({
          type: 'approval.resolve',
          runId,
          approvalId: event.approvalId,
          ...decide(event),
        });
      }
    }, 25);
    return { asked, stop: () => clearInterval(timer) };
  }

  const finished = (runId: string) =>
    eventsOf(runId).some(
      (e) =>
        e.type === 'run.completed' ||
        e.type === 'error' ||
        (e.type === 'run.status' && e.status === 'cancelled'),
    );

  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aios-e2e-')));
    repo = path.join(base, 'izin', 'aplikasi');
    await fs.mkdir(repo, { recursive: true });
    await fs.writeFile(path.join(repo, 'math.js'), 'exports.add = (a, b) => a + b;\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"aplikasi","type":"commonjs"}\n');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'awal');

    steps = (toolResults) => {
      if (toolResults === 0)
        return { tool: { name: 'write', args: { path: 'math.test.js', content: TEST_SOURCE } } };
      if (toolResults === 1) return { tool: { name: 'bash', args: { command: 'node --test' } } };
      return { text: 'Tes untuk add sudah ditambahkan dan lulus.' };
    };
    llm = mockLlm((toolResults, request) => steps(toolResults, request));
    gateway = new FakeGateway();
    gateway.httpHandler = (req, res) => {
      if (req.url?.startsWith('/llm/v1/')) {
        req.url = req.url.slice('/llm'.length);
        llm.handler(req, res);
      } else {
        res.writeHead(404).end();
      }
    };
    await gateway.start();

    worker = await startWorker({
      token: 'token-e2e-1234567890-abcdef',
      dataDir: path.join(base, 'data'),
      forbiddenFolders: [],
      maxRunMs: 120_000,
    });
    await worker.allowed.add(path.join(base, 'izin'));
    await worker.bindings.bind(PROJECT, repo);
    accessToken = fresh();
    worker.link.setSession({
      serverUrl: gateway.url,
      accessToken,
      refreshToken: 'r',
      deviceId: DEVICE,
    });
    await until(() => worker.link.state === 'connected', 'worker tersambung ke gateway');
  });

  afterEach(async () => {
    await worker.stop();
    await gateway.stop();
    await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('tugas "tambahkan tes": berjalan di worktree, meminta izin, tes lulus, dan branch kerja asli tidak berubah', async () => {
    const mainBefore = git(repo, 'rev-parse', 'main');
    const answers = autoAnswer(RUN_1, () => ({ decision: 'allow', remember: false }));

    sendCommand(startCommand(RUN_1));
    await until(() => finished(RUN_1), 'run selesai', 90_000);
    answers.stop();

    const events = eventsOf(RUN_1);
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
    expect(events.some((e) => e.type === 'error')).toBe(false);

    // Meminta izin: tulis file, lalu jalankan tes dengan perintah persis dan cwd = worktree.
    expect(answers.asked.map((a) => [a.kind, a.detail.split('\n')[0]])).toEqual([
      ['file_write', 'Path: math.test.js'],
      ['command', 'node --test'],
    ]);
    const wt = worker.worktrees.get(RUN_1)!;
    expect(answers.asked[1]?.cwd).toBe(wt.cwd);
    expect(wt.cwd.startsWith(repo)).toBe(false);

    // Tes benar-benar dijalankan di worktree dan keluarannya terkirim.
    const output = events
      .filter((e) => e.type === 'tool.output')
      .map((e) => (e as { chunk: string }).chunk)
      .join('');
    expect(output).toMatch(/pass 1/);
    expect(
      events.filter((e) => e.type === 'tool.finished').map((e) => (e as { status: string }).status),
    ).toEqual(['ok', 'ok']);
    expect(events.find((e) => e.type === 'message.delta')).toBeDefined();

    // Hasil ada di worktree, bukan di repo kerja; branch kerja asli tidak berubah.
    await expect(fs.stat(path.join(wt.cwd, 'math.test.js'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(repo, 'math.test.js'))).rejects.toThrow();
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'rev-parse', 'main')).toBe(mainBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'branch', '--list', wt.branch)).toContain(wt.branch);
    // Tidak ada berkas omp di repo kerja maupun worktree.
    expect(await fs.readdir(wt.cwd)).not.toContain('.omp');
    expect(await fs.readdir(repo)).not.toContain('.omp');
  }, 120_000);

  it('LLM dipanggil lewat proxy lokal dengan token perangkat segar (bukan kunci lokal) dan role ada di system prompt', async () => {
    const answers = autoAnswer(RUN_1, () => ({ decision: 'allow', remember: false }));
    sendCommand(startCommand(RUN_1));
    await until(() => finished(RUN_1), 'run selesai', 90_000);
    answers.stop();

    expect(llm.requests.length).toBeGreaterThanOrEqual(3);
    for (const request of llm.requests) {
      expect(request.auth).toBe(`Bearer ${accessToken}`);
      expect(request.url).toBe('/v1/chat/completions');
    }
    const system = llm.requests[0]?.body.messages.find((m) => m.role === 'system');
    expect(JSON.stringify(system?.content)).toContain('Tulis tes yang kecil dan jelas.');
    expect(llm.requests[0]?.body.model).toBe('mock-1');
  }, 120_000);

  it('Tolak: perintah tes tidak dijalankan dan statusnya denied', async () => {
    const answers = autoAnswer(RUN_1, (event) =>
      event.kind === 'command'
        ? { decision: 'deny', remember: false }
        : { decision: 'allow', remember: false },
    );

    sendCommand(startCommand(RUN_1));
    await until(() => finished(RUN_1), 'run selesai', 90_000);
    answers.stop();

    const statuses = eventsOf(RUN_1)
      .filter((e) => e.type === 'tool.finished')
      .map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(['ok', 'denied']);
    expect(
      eventsOf(RUN_1)
        .filter((e) => e.type === 'tool.output')
        .some((e) => /pass \d/.test((e as { chunk: string }).chunk)),
    ).toBe(false);
  }, 120_000);

  it('"Selalu untuk project ini": run berikutnya tidak meminta izin untuk perintah yang sama', async () => {
    const first = autoAnswer(RUN_1, (event) => ({
      decision: 'allow',
      remember: event.kind === 'command',
    }));
    sendCommand(startCommand(RUN_1));
    await until(() => finished(RUN_1), 'run pertama selesai', 90_000);
    first.stop();
    expect(first.asked).toHaveLength(2);
    await worker.coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN_1,
      decision: 'reject',
      comments: [],
      merge: false,
    });

    const second = autoAnswer(RUN_2, () => ({ decision: 'allow', remember: false }));
    sendCommand(startCommand(RUN_2));
    await until(() => finished(RUN_2), 'run kedua selesai', 90_000);
    second.stop();

    expect(second.asked.map((a) => a.kind)).toEqual(['file_write']); // perintah tes dijawab otomatis
    expect(eventsOf(RUN_2).filter((e) => e.type === 'tool.finished')).toHaveLength(2);
    expect(eventsOf(RUN_2).at(-1)).toMatchObject({ type: 'run.completed' });
  }, 180_000);

  it('hasil diterima: di-commit pada branch kerja, worktree bersih, branch asli tetap', async () => {
    const answers = autoAnswer(RUN_1, () => ({ decision: 'allow', remember: false }));
    sendCommand(startCommand(RUN_1));
    await until(() => finished(RUN_1), 'run selesai', 90_000);
    answers.stop();
    const wt = worker.worktrees.get(RUN_1)!;
    const mainBefore = git(repo, 'rev-parse', 'main');

    await worker.coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN_1,
      decision: 'accept',
      comments: [],
      merge: false,
    });

    await expect(fs.stat(wt.root)).rejects.toThrow();
    expect(git(repo, 'ls-tree', '-r', '--name-only', wt.branch)).toContain('math.test.js');
    expect(git(repo, 'rev-parse', 'main')).toBe(mainBefore);
    expect(git(repo, 'branch', '--show-current')).toBe('main');
  }, 120_000);

  it('cancel di tengah jawaban: omp dihentikan, tidak ada proses yatim, worktree tanpa perubahan dibuang', async () => {
    steps = () => ({
      text: 'x',
      parts: Array.from({ length: 200 }, (_, i) => `bagian-${i} `),
      partDelayMs: 100,
    });

    sendCommand(startCommand(RUN_1));
    await until(
      () => eventsOf(RUN_1).some((e) => e.type === 'message.delta'),
      'jawaban mengalir',
      60_000,
    );
    sendCommand({ type: 'run.cancel', runId: RUN_1 });

    await until(() => finished(RUN_1), 'run dibatalkan', 30_000);
    expect(eventsOf(RUN_1).at(-1)).toEqual({ type: 'run.status', status: 'cancelled' });
    await until(() => worker.processes.running === 0, 'proses omp berhenti', 15_000);
    await until(() => worker.worktrees.get(RUN_1) === undefined, 'worktree dibuang', 15_000);
    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');
  }, 120_000);

  it('galat model (HTTP 500) menjadi error dengan kode model_http_500 setelah omp selesai mencoba ulang', async () => {
    steps = () => ({ status: 500 });

    sendCommand(startCommand(RUN_1));
    await until(() => finished(RUN_1), 'error', 60_000);

    expect(eventsOf(RUN_1).at(-1)).toMatchObject({
      type: 'error',
      code: 'model_http_500',
      retryable: true,
    });
    // omp mengulang permintaan sendiri di lapisan SDK-nya (±12 kali, ±40 detik) dan tidak bisa dimatikan lewat
    // set_auto_retry maupun retry.* (docs/BACKLOG.md, Temuan Fase 18); yang dijamin: akhirnya error yang jelas.
    expect(llm.requests.length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('tinjau: komentar di satu baris membuat agent memperbaiki bagian itu; diff diterima dan commit tercipta', async () => {
    const BUGGY = [
      'exports.add = (a, b) => a + b;',
      'exports.sub = (a, b) => a - b;',
      'exports.mul = (a, b) => a + b;',
      '',
    ].join('\n');
    const FIXED = BUGGY.replace('mul = (a, b) => a + b', 'mul = (a, b) => a * b');
    const comment = { path: 'math.js', line: 3, body: 'mul harus mengalikan, bukan menjumlahkan' };
    const bundled = [
      'Saya meninjau perubahan Anda dan ada komentar pada baris tertentu.',
      'Perbaiki hanya bagian yang dikomentari dan jangan ubah bagian lain.',
      'Nomor baris merujuk ke versi berkas saat ini (setelah perubahan Anda).',
      '',
      `- ${comment.path}:${comment.line} — ${comment.body}`,
    ].join('\n');
    // Skrip model: run pertama menulis math.js dengan bug di baris 3; run revisi (dikenali dari pesan
    // komentar) menulis ulang dengan perbaikan.
    const isRevision = (request: ChatRequest) =>
      JSON.stringify(request.body.messages).includes(`${comment.path}:${comment.line}`);
    steps = (toolResults, request) => {
      if (isRevision(request)) {
        return toolResults === 0
          ? { tool: { name: 'write', args: { path: 'math.js', content: FIXED } } }
          : { text: 'Baris 3 diperbaiki.\nCommit: fix: perbaiki mul' };
      }
      return toolResults === 0
        ? { tool: { name: 'write', args: { path: 'math.js', content: BUGGY } } }
        : { text: 'Menambahkan sub dan mul.\nCommit: feat: tambah sub dan mul' };
    };
    const mainBefore = git(repo, 'rev-parse', 'main');

    // Run pertama: agent menulis math.js; diff dan checkpoint tersedia untuk ditinjau.
    const first = autoAnswer(RUN_1, () => ({ decision: 'allow', remember: false }));
    sendCommand(startCommand(RUN_1, { prompt: 'tambahkan sub dan mul di math.js' }));
    await until(() => finished(RUN_1), 'run pertama selesai', 90_000);
    first.stop();
    const firstEvents = eventsOf(RUN_1);
    expect(firstEvents.map((e) => e.type)).toEqual(
      expect.arrayContaining(['checkpoint.created', 'diff.updated']),
    );
    expect(firstEvents.findLast((e) => e.type === 'diff.updated')).toMatchObject({
      files: [{ path: 'math.js', additions: 2, deletions: 0 }],
    });
    const reviewed = await worker.review.get(RUN_1);
    expect(reviewed.files.map((f) => f.path)).toEqual(['math.js']);
    expect(reviewed.files[0]?.patch).toContain('+exports.mul = (a, b) => a + b;');
    expect(reviewed.checkpoints).toHaveLength(1);
    expect(reviewed.commitMessage).toBe('feat: tambah sub dan mul');
    const afterFirst = reviewed.checkpoints[0]!.id;

    // Komentar dibundel jadi satu pesan; agent melanjutkan di worktree yang sama.
    const second = autoAnswer(RUN_2, () => ({ decision: 'allow', remember: false }));
    sendCommand(startCommand(RUN_2, { prompt: bundled, continueFromRunId: RUN_1 }));
    await until(() => finished(RUN_2), 'run revisi selesai', 90_000);
    second.stop();
    expect(eventsOf(RUN_2).some((e) => e.type === 'error')).toBe(false);
    expect(llm.requests.some(isRevision)).toBe(true);

    // Hanya baris yang dikomentari yang berubah di antara dua checkpoint; sisanya tetap.
    const state = await worker.review.get(RUN_2);
    expect(state.checkpoints).toHaveLength(2);
    const wt = worker.worktrees.get(RUN_2)!;
    expect(wt.branch).toBe(reviewed.branch);
    const delta = git(wt.root, 'diff', '--unified=0', afterFirst, state.checkpoints[1]!.id);
    expect(delta).toContain('-exports.mul = (a, b) => a + b;');
    expect(delta).toContain('+exports.mul = (a, b) => a * b;');
    expect(delta.split('\n').filter((l) => /^[-+](?![-+])/.test(l))).toHaveLength(2);
    expect(state.files[0]?.patch).toContain('+exports.mul = (a, b) => a * b;');
    // Repo kerja belum tersentuh sebelum diterima.
    expect(git(repo, 'rev-parse', 'main')).toBe(mainBefore);
    expect(git(repo, 'status', '--porcelain')).toBe('');

    // Terima + gabungkan: satu commit Conventional Commits dari agent, fast-forward ke main.
    const result = await worker.coordinator.reviewApply({
      type: 'review.apply',
      runId: RUN_2,
      decision: 'accept',
      comments: [],
      merge: true,
    });

    expect(result).toMatchObject({ ok: true, merged: true, mergeSkipped: null });
    expect(git(repo, 'log', '-1', '--format=%s', 'main')).toBe('feat: tambah sub dan mul');
    expect(git(repo, 'rev-list', '--count', `${mainBefore}..main`)).toBe('1');
    expect((await fs.readFile(path.join(repo, 'math.js'), 'utf8')).replace(/\r/g, '')).toBe(FIXED);
    expect(git(repo, 'branch', '--list', 'aios/*')).toBe('');
    await expect(fs.stat(wt.root)).rejects.toThrow();
  }, 240_000);

  it('project belum terikat: error jelas tanpa menjalankan omp', async () => {
    sendCommand(startCommand(RUN_1, { projectId: '0192f0c4-7a1b-7c2d-a009-4a5b6c7d8e99' }));
    await until(() => finished(RUN_1), 'error', 15_000);

    expect(eventsOf(RUN_1)[0]).toMatchObject({ type: 'error', code: 'project_not_bound' });
    expect(llm.requests).toHaveLength(0);
  }, 30_000);
});
