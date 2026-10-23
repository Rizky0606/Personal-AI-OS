import nodePath from 'node:path';
import { createOmpAdapter, stdioTransport } from '@aios/adapters';
import type { LocalPush, WorkerCommand } from '@aios/contracts';
import { GatewayLink } from './gateway/link.js';
import { createHandler, workerStatus } from './local/handlers.js';
import { LocalServer } from './local/server.js';
import { LlmProxy } from './llm/proxy.js';
import { AllowList } from './paths/allowlist.js';
import { canonicalize } from './paths/normalize.js';
import { ProcessManager } from './process/manager.js';
import { ProjectBindings } from './projects/bindings.js';
import { RunCoordinator } from './runs/coordinator.js';
import { resolveOmp } from './runs/omp-path.js';
import { ApprovalRules } from './runs/rules.js';
import { WorktreeManager } from './runs/worktree.js';
import { WORKER_VERSION } from './version.js';

export interface WorkerOptions {
  /** Token lokal sekali pakai untuk koneksi pertama dari desktop. */
  token: string;
  /** Folder data worker (daftar folder izin, ikatan project, aturan izin, worktree cadangan). */
  dataDir: string;
  log?: (message: string) => void;
  /** Folder yang tidak boleh diizinkan; default folder home. Diganti di tes. */
  forbiddenFolders?: string[];
  /** Lingkungan untuk mencari omp; default process.env. Diganti di tes. */
  env?: NodeJS.ProcessEnv;
  /** Batas waktu run (ms); default 30 menit. */
  maxRunMs?: number;
}

export interface RunningWorker {
  port: number;
  link: GatewayLink;
  allowed: AllowList;
  bindings: ProjectBindings;
  processes: ProcessManager;
  worktrees: WorktreeManager;
  rules: ApprovalRules;
  coordinator: RunCoordinator;
  stop(): Promise<void>;
}

/** Merakit worker: izin folder, ikatan project, proses anak, run coding, proxy LLM, gateway, dan server lokal. */
export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const log = options.log ?? (() => undefined);
  const env = options.env ?? process.env;

  const allowed = new AllowList({
    file: nodePath.join(options.dataDir, 'allowed-folders.json'),
    ...(options.forbiddenFolders ? { forbidden: options.forbiddenFolders } : {}),
  });
  await allowed.load();
  const bindings = new ProjectBindings(nodePath.join(options.dataDir, 'projects.json'), allowed);
  await bindings.load();
  const rules = new ApprovalRules(nodePath.join(options.dataDir, 'approval-rules.json'));
  await rules.load();

  // Proses anak berjalan di folder yang diizinkan atau di dalam worktree yang worker buat sendiri.
  // ProcessManager dan WorktreeManager saling membutuhkan; pemegang ini memutus lingkarannya.
  const holder: { worktrees?: WorktreeManager } = {};
  const processes = new ProcessManager({
    checkCwd: async (cwd) => {
      try {
        return await allowed.resolveDirectory(cwd);
      } catch (error) {
        const real = await canonicalize(cwd).catch(() => undefined);
        if (real !== undefined && holder.worktrees?.contains(real) === true) return real;
        throw error;
      }
    },
  });
  const worktrees = new WorktreeManager({ processes, allowed, dataDir: options.dataDir });
  holder.worktrees = worktrees;

  const link: GatewayLink = new GatewayLink({ onCommand: (command) => dispatch(command) });
  const proxy = new LlmProxy({
    serverUrl: () => link.serverUrl,
    token: (opts) => link.freshAccessToken(opts),
    log,
  });
  const proxyPort = await proxy.start();

  const adapter = createOmpAdapter({
    llm: { baseUrl: `http://127.0.0.1:${proxyPort}/v1`, apiKey: proxy.key },
    launch: async (spec) => {
      const exe = await resolveOmp(env);
      const tracked = await processes.spawnTracked(exe, spec.args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env, NO_COLOR: '1' },
        runId: spec.runId,
      });
      // stderr omp hanya untuk diagnosis worker; tidak diteruskan ke gateway.
      tracked.child.stderr.on('data', (chunk: Buffer) =>
        log(`omp: ${chunk.toString('utf8').trimEnd()}`),
      );
      return stdioTransport(tracked.child, () => tracked.kill());
    },
  });

  const coordinator = new RunCoordinator({
    bindings,
    worktrees,
    processes,
    rules,
    adapter,
    send: (runId, event) => link.sendEvent(runId, event),
    dataDir: options.dataDir,
    log,
    ...(options.maxRunMs ? { maxRunMs: options.maxRunMs } : {}),
  });

  function dispatch(command: WorkerCommand): void {
    switch (command.type) {
      case 'run.start':
        coordinator.start(command);
        break;
      case 'run.steer':
        coordinator.steer(command.runId, command.text);
        break;
      case 'run.cancel':
        coordinator.cancel(command.runId);
        break;
      case 'approval.resolve':
        void coordinator.resolveApproval(command);
        break;
      case 'review.apply':
        void coordinator.reviewApply(command).catch((error: unknown) => {
          log(`review.apply ${command.runId} gagal: ${String(error)}`);
        });
        break;
    }
  }

  const deps = { allowed, bindings, processes, link, version: WORKER_VERSION };
  const server = new LocalServer({
    token: options.token,
    handle: createHandler(deps),
    status: () => ({ ...workerStatus(deps), activeRuns: coordinator.activeRunIds.length }),
    log,
  });

  const pushStatus = () =>
    server.push({
      push: 'status',
      status: { ...workerStatus(deps), activeRuns: coordinator.activeRunIds.length },
    });
  link.onState((state) => {
    pushStatus();
    // Koneksi pulih: kirim event run yang tertahan selama putus.
    if (state === 'connected') coordinator.flushAll();
  });
  link.onSession((session) => {
    const message: LocalPush = {
      push: 'session.updated',
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
    server.push(message);
  });
  link.onInvalid(() => {
    server.push({ push: 'session.invalid' });
    pushStatus();
  });

  const port = await server.start();
  return {
    port,
    link,
    allowed,
    bindings,
    processes,
    worktrees,
    rules,
    coordinator,
    async stop() {
      link.stop();
      await processes.killAll();
      await proxy.close();
      await server.close();
    },
  };
}
