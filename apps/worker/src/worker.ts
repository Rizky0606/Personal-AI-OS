import nodePath from 'node:path';
import type { LocalPush, WorkerCommand } from '@aios/contracts';
import { GatewayLink } from './gateway/link.js';
import { createHandler, workerStatus } from './local/handlers.js';
import { LocalServer } from './local/server.js';
import { AllowList } from './paths/allowlist.js';
import { ProcessManager } from './process/manager.js';
import { ProjectBindings } from './projects/bindings.js';
import { WORKER_VERSION } from './version.js';

export interface WorkerOptions {
  /** Token lokal sekali pakai untuk koneksi pertama dari desktop. */
  token: string;
  /** Folder data worker (daftar folder izin dan ikatan project). */
  dataDir: string;
  log?: (message: string) => void;
  /** Folder yang tidak boleh diizinkan; default folder home. Diganti di tes. */
  forbiddenFolders?: string[];
}

export interface RunningWorker {
  port: number;
  link: GatewayLink;
  allowed: AllowList;
  processes: ProcessManager;
  stop(): Promise<void>;
}

/** Merakit worker: izin folder, ikatan project, pengelola proses, koneksi gateway, dan server lokal. */
export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const log = options.log ?? (() => undefined);
  const allowed = new AllowList({
    file: nodePath.join(options.dataDir, 'allowed-folders.json'),
    ...(options.forbiddenFolders ? { forbidden: options.forbiddenFolders } : {}),
  });
  await allowed.load();
  const bindings = new ProjectBindings(nodePath.join(options.dataDir, 'projects.json'), allowed);
  await bindings.load();
  // Proses anak hanya boleh berjalan di folder yang diizinkan.
  const processes = new ProcessManager({ checkCwd: (cwd) => allowed.resolveDirectory(cwd) });

  const link: GatewayLink = new GatewayLink({
    onCommand: (command) => rejectUnsupported(command, link),
  });
  const deps = { allowed, bindings, processes, link, version: WORKER_VERSION };
  const server = new LocalServer({
    token: options.token,
    handle: createHandler(deps),
    status: () => workerStatus(deps),
    log,
  });

  const pushStatus = () => server.push({ push: 'status', status: workerStatus(deps) });
  link.onState(pushStatus);
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
    processes,
    async stop() {
      link.stop();
      await processes.killAll();
      await server.close();
    },
  };
}

/** Run coding datang di Fase 18 (adapter omp). Sampai itu, jawab jujur supaya run tidak menggantung. */
function rejectUnsupported(command: WorkerCommand, link: GatewayLink): void {
  if (command.type !== 'run.start') return;
  link.sendEvent(command.runId, {
    type: 'error',
    code: 'worker_not_ready',
    message: 'Worker ini belum bisa menjalankan run coding.',
    retryable: false,
  });
  link.sendEvent(command.runId, { type: 'run.status', status: 'failed' });
}
