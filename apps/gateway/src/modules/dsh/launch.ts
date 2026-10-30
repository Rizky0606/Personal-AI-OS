import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  createDshAdapter,
  stdioTransport,
  type AcpLaunch,
  type AgentAdapter,
} from '@aios/adapters';
import type { EngineInfo } from '@aios/contracts';
import type { Config } from '../../config.js';

export interface DshDeps {
  config: Pick<
    Config,
    | 'DSH_COMMAND'
    | 'DSH_ARGS'
    | 'DSH_HOME'
    | 'DSH_WORKDIR_ROOT'
    | 'DSH_UID'
    | 'DSH_GID'
    | 'DSH_MAX_MEMORY_MB'
    | 'DSH_RUN_TIMEOUT_MS'
    | 'DSH_IDLE_TIMEOUT_MS'
    | 'DSH_APPROVAL_TIMEOUT_MS'
    | 'NINEROUTER_API_KEY'
  >;
  log?: {
    warn: (obj: object, msg: string) => void;
    debug?: (obj: object, msg: string) => void;
  };
  /** Dasar lingkungan proses (diinjeksi di tes); default `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** UID proses gateway (diinjeksi di tes); default `process.getuid?.()`. */
  uid?: number | undefined;
}

/** Lingkungan minimal untuk dsh: bukan seluruh env gateway (DATABASE_URL, AUTH_SECRET, dst. tidak ikut). */
export function dshEnv(config: DshDeps['config'], base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'LANG', 'TZ', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR']) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  if (config.DSH_HOME) {
    env.DSH_HOME = config.DSH_HOME;
    env.HOME = config.DSH_HOME;
  } else if (base.HOME) {
    env.HOME = base.HOME;
  }
  // Kunci provider hanya ada di proses ini (dibaca profil acp lewat apiKeyEnv); tidak pernah ke klien.
  if (config.NINEROUTER_API_KEY) env.DSH_LLM_API_KEY = config.NINEROUTER_API_KEY;
  env.NODE_OPTIONS = `--max-old-space-size=${config.DSH_MAX_MEMORY_MB}`;
  return env;
}

/** Bunuh pohon proses: grup proses di POSIX (`detached`), `taskkill /T` di Windows. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Sudah mati.
  }
}

/** Isi `GET /engines`: dsh selalu terdaftar; `available` mengikuti konfigurasi `DSH_COMMAND`. */
export function dshEngineList(engine: unknown): EngineInfo[] {
  return [
    {
      id: 'dsh',
      label: 'DeepSeek Harness (dsh)',
      available: engine !== undefined,
      experimental: true,
    },
  ];
}

/** Adapter dsh untuk gateway, atau `undefined` bila `DSH_COMMAND` kosong. */
export function createDshEngine(
  deps: DshDeps,
):
  | { adapter: AgentAdapter; prepareWorkdir: (runId: string) => Promise<string>; close: () => void }
  | undefined {
  const { config } = deps;
  const command = config.DSH_COMMAND;
  const root = config.DSH_WORKDIR_ROOT;
  if (!command || !root) return undefined;
  if (!isAbsolute(root)) throw new Error('DSH_WORKDIR_ROOT harus jalur absolut.');
  // dsh tidak diaudit: tidak pernah berjalan sebagai root. Gateway root hanya boleh menurunkan hak lewat DSH_UID/DSH_GID.
  const gatewayUid = 'uid' in deps ? deps.uid : process.getuid?.();
  if (gatewayUid === 0 && config.DSH_UID === undefined) {
    throw new Error(
      'Gateway berjalan sebagai root: isi DSH_UID dan DSH_GID agar dsh berjalan sebagai pengguna non-root.',
    );
  }
  const args = config.DSH_ARGS.split(/\s+/).filter(Boolean);
  const base = deps.env ?? process.env;
  const running = new Set<() => void>();
  const adapter = createDshAdapter({
    args,
    idleTimeoutMs: config.DSH_IDLE_TIMEOUT_MS,
    maxRunMs: config.DSH_RUN_TIMEOUT_MS,
    approvalTimeoutMs: config.DSH_APPROVAL_TIMEOUT_MS,
    onUnknown: (kind) => deps.log?.debug?.({ kind }, 'event ACP tak dikenal diabaikan'),
    launch: (spec: AcpLaunch) => {
      const child = spawn(command, spec.args, {
        cwd: spec.cwd,
        env: { ...dshEnv(config, base), ...spec.env },
        stdio: 'pipe',
        detached: process.platform !== 'win32',
        windowsHide: true,
        ...(config.DSH_UID !== undefined && config.DSH_GID !== undefined
          ? { uid: config.DSH_UID, gid: config.DSH_GID }
          : {}),
      });
      // stderr dsh = log; masuk log gateway (tanpa isi prompt), tidak pernah ke klien.
      child.stderr.on('data', (chunk: Buffer) =>
        deps.log?.debug?.(
          { runId: spec.runId, stderr: chunk.toString('utf8').slice(0, 2000) },
          'dsh stderr',
        ),
      );
      child.on('error', (err) =>
        deps.log?.warn({ runId: spec.runId, err }, 'dsh gagal dijalankan'),
      );
      const kill = () => killTree(child.pid);
      running.add(kill);
      child.once('close', () => running.delete(kill));
      return stdioTransport(child, kill);
    },
  });

  return {
    adapter,
    async prepareWorkdir(runId) {
      const dir = join(root, runId);
      // Pengguna dsh berbeda dari gateway: akar `DSH_WORKDIR_ROOT` bermode 2770 (setgid) milik grup dsh (RUNBOOK_DSH.md).
      await mkdir(dir, { recursive: true, mode: config.DSH_UID === undefined ? 0o700 : 0o770 });
      return dir;
    },
    /** Mematikan semua proses dsh yang masih berjalan (shutdown gateway): tidak ada proses yatim. */
    close() {
      for (const kill of [...running]) kill();
    },
  };
}
