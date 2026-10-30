import type { PreviewInfo } from '@aios/contracts';
import type { ProcessManager } from '../process/manager.js';
import { BrowserError, BrowserHost, BrowserSession } from './browser.js';
import { detectDevCommand } from './devcommand.js';
import { DevServer, DevServerError } from './devserver.js';
import { McpServer, type McpRegistration } from './mcp.js';
import { linkNodeModules } from './nodemodules.js';
import { PreviewProxy } from './proxy.js';

export class PreviewError extends Error {
  constructor(
    readonly code: 'preview_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'PreviewError';
  }
}

export interface PreviewTargetInput {
  projectId: string;
  runId?: string | undefined;
}

/** Folder tempat dev server berjalan: worktree run, atau folder project. */
export type PreviewResolver = (
  target: PreviewTargetInput,
) => Promise<{ cwd: string; projectPath: string }>;

interface Entry {
  info: PreviewInfo;
  server?: DevServer;
  proxy?: PreviewProxy;
  starting?: Promise<PreviewInfo>;
}

export interface PreviewServiceOptions {
  processes: ProcessManager;
  resolve: PreviewResolver;
  browser?: BrowserHost;
  readyTimeoutMs?: number;
  onChange?: (info: PreviewInfo) => void;
  log?: (message: string) => void;
  uploadArtifact?: (runId: string, bytes: Buffer) => Promise<boolean>;
}

export const previewKey = (target: PreviewTargetInput): string =>
  target.runId ? `run:${target.runId}` : `project:${target.projectId}`;

/**
 * Preview website per project atau per run: mendeteksi perintah dev server, menjalankannya di worktree/folder
 * project, memasang proxy (untuk jembatan console dan inspeksi), dan menyediakan sesi browser untuk agent.
 * Dev server run dimatikan saat run selesai; yang dari folder project berhenti saat tab ditutup.
 */
export class PreviewService {
  private readonly entries = new Map<string, Entry>();
  private readonly sessions = new Map<string, BrowserSession>();
  readonly browser: BrowserHost;
  readonly mcp = new McpServer();

  constructor(private readonly options: PreviewServiceOptions) {
    this.browser = options.browser ?? new BrowserHost();
  }

  get browserAvailable(): boolean {
    return this.browser.available;
  }

  get(target: PreviewTargetInput): PreviewInfo | undefined {
    return this.entries.get(previewKey(target))?.info;
  }

  private set(entry: Entry, patch: Partial<PreviewInfo>): void {
    entry.info = { ...entry.info, ...patch };
    this.options.onChange?.(entry.info);
  }

  /** Menjalankan preview (atau mengembalikan yang sudah berjalan). Tidak melempar: kegagalan ada di `status: failed`. */
  start(target: PreviewTargetInput): Promise<PreviewInfo> {
    const key = previewKey(target);
    const existing = this.entries.get(key);
    if (existing?.starting) return existing.starting;
    if (existing?.info.status === 'ready' && !existing.server?.dead) {
      return Promise.resolve(existing.info);
    }
    const entry: Entry = {
      info: {
        key,
        projectId: target.projectId,
        runId: target.runId ?? null,
        status: 'starting',
        url: null,
        devUrl: null,
        command: null,
        error: null,
        log: '',
      },
    };
    this.entries.set(key, entry);
    this.options.onChange?.(entry.info);
    entry.starting = this.boot(entry, target).finally(() => {
      entry.starting = undefined;
    });
    return entry.starting;
  }

  private async boot(entry: Entry, target: PreviewTargetInput): Promise<PreviewInfo> {
    const fail = (message: string, log = '') => {
      this.set(entry, { status: 'failed', error: message, log });
      return entry.info;
    };
    try {
      const { cwd, projectPath } = await this.options.resolve(target);
      const command = await detectDevCommand(cwd);
      if (!command) {
        return fail(
          'Tidak ada skrip dev di package.json (dev, start, serve, atau preview). Tambahkan skrip untuk menjalankan dev server.',
        );
      }
      this.set(entry, { command: command.label });
      await linkNodeModules(this.options.processes, projectPath, cwd).catch((error: unknown) =>
        this.options.log?.(`node_modules tidak ditautkan: ${String(error)}`),
      );

      const server = new DevServer({
        processes: this.options.processes,
        cwd,
        command,
        runId: target.runId,
        ...(this.options.readyTimeoutMs ? { readyTimeoutMs: this.options.readyTimeoutMs } : {}),
        onExit: () => {
          if (entry.info.status === 'ready' && this.entries.get(entry.info.key) === entry) {
            this.set(entry, {
              status: 'failed',
              error: 'Dev server berhenti. Jalankan preview lagi.',
              log: server.log,
            });
          }
        },
      });
      entry.server = server;
      const devUrl = await server.start();
      const proxy = new PreviewProxy(new URL(devUrl));
      entry.proxy = proxy;
      const url = await proxy.start();
      this.set(entry, { status: 'ready', url, devUrl, error: null, log: server.log });
      return entry.info;
    } catch (error) {
      entry.server?.stop();
      await entry.proxy?.stop().catch(() => undefined);
      if (error instanceof DevServerError) return fail(error.message, error.log);
      this.options.log?.(`preview gagal: ${String(error)}`);
      return fail(error instanceof Error ? error.message : 'Preview gagal dijalankan.');
    }
  }

  /** Ekor log terbaru dev server yang sedang berjalan. */
  log(target: PreviewTargetInput): string {
    const entry = this.entries.get(previewKey(target));
    return entry?.server?.log ?? entry?.info.log ?? '';
  }

  async stop(target: PreviewTargetInput): Promise<void> {
    const key = previewKey(target);
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.server?.stop();
    await entry.proxy?.stop().catch(() => undefined);
    this.set(entry, { status: 'stopped', url: null, devUrl: null });
    if (target.runId) await this.closeSession(target.runId);
  }

  /** Run selesai: dev server, proxy, dan browser milik run itu dihentikan. */
  async stopRun(projectId: string, runId: string): Promise<void> {
    await this.stop({ projectId, runId });
    await this.closeSession(runId);
  }

  /** Menghentikan preview yang berjalan di worktree sebuah run (tanpa perlu tahu project-nya). */
  async stopByRun(runId: string): Promise<void> {
    const entry = this.entries.get(`run:${runId}`);
    if (entry) await this.stop({ projectId: entry.info.projectId, runId });
  }

  async stopAll(): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      await this.stop({
        projectId: entry.info.projectId,
        ...(entry.info.runId ? { runId: entry.info.runId } : {}),
      });
    }
    for (const runId of [...this.sessions.keys()]) await this.closeSession(runId);
    await this.browser.close();
    await this.mcp.stop();
  }

  private async closeSession(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    this.sessions.delete(runId);
    await session?.close();
  }

  /**
   * Menyiapkan tool browser untuk satu run: mendaftarkannya di server MCP lokal dan mengembalikan konfigurasi
   * untuk omp. Dev server baru dijalankan saat tool pertama dipakai.
   */
  async registerRun(target: Required<PreviewTargetInput>): Promise<McpRegistration | undefined> {
    if (!this.browser.available) return undefined;
    await this.mcp.start();
    const session = new BrowserSession(this.browser, async () => {
      const info = await this.start(target);
      if (info.status !== 'ready' || !info.devUrl) {
        throw new BrowserError(
          'preview_not_running',
          `Dev server tidak bisa dijalankan: ${info.error ?? 'penyebab tidak diketahui'}${info.log ? `\n${info.log.slice(-1500)}` : ''}`,
        );
      }
      return info.devUrl;
    });
    this.sessions.set(target.runId, session);
    return this.mcp.register(target.runId, session, this.options.uploadArtifact);
  }

  /** Tangkapan satu elemen (atau viewport) dari preview yang berjalan, untuk lampiran composer. */
  async shot(
    target: PreviewTargetInput,
    options: {
      selector?: string | undefined;
      width?: number | undefined;
      height?: number | undefined;
    },
  ): Promise<{ png: Buffer; width: number; height: number }> {
    const info = this.get(target);
    if (info?.status !== 'ready' || !info.devUrl) {
      throw new PreviewError('preview_unavailable', 'Preview belum berjalan.');
    }
    const devUrl = info.devUrl;
    const session = new BrowserSession(this.browser, () => Promise.resolve(devUrl));
    try {
      const shot = await session.screenshot(options);
      return { png: shot.png, width: shot.viewport.width, height: shot.viewport.height };
    } catch (error) {
      if (error instanceof BrowserError)
        throw new PreviewError('preview_unavailable', error.message);
      throw error;
    } finally {
      await session.close();
    }
  }
}
