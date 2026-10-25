import { createHermesAdapter, createWorkerRelayAdapter } from '@aios/adapters';
import { LoginResponseSchema, type ResearchDepth, type DeviceKind } from '@aios/contracts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type RateLimits } from '../app.js';
import { saveOwner } from '../modules/auth/owner.js';
import { deriveAuthKeys } from '../modules/auth/secrets.js';
import { createAuthService } from '../modules/auth/service.js';
import { generateTotpSecret, timeStep, totpCode } from '../modules/auth/totp.js';
import { createChatService, type ChatService } from '../modules/chat/service.js';
import { createFilesService } from '../modules/files/service.js';
import { createTitleService } from '../modules/chat/title.js';
import { createDevicesService } from '../modules/devices/service.js';
import { createMemoryService } from '../modules/memory/service.js';
import { createSpacesService } from '../modules/spaces/service.js';
import { createNineRouterClient } from '../modules/llm/client.js';
import { createModelsService } from '../modules/llm/models.js';
import { createQuotaService, createUsageRecorder } from '../modules/llm/usage.js';
import { createRouterComplete } from '../modules/router/complete.js';
import { createRoutingService } from '../modules/router/service.js';
import { type RoutingService } from '../modules/router/service.js';
import { PgBoss } from 'pg-boss';
import { createFcmClient, type ServiceAccount } from '../modules/push/fcm.js';
import { createPushService, type PushService } from '../modules/push/service.js';
import { createScheduleParser } from '../modules/schedules/parser.js';
import { createScheduleService, type ScheduleService } from '../modules/schedules/service.js';
import { createPageFetcher } from '../modules/research/fetcher.js';
import { createResearchLlm } from '../modules/research/llm.js';
import type { DepthConfig } from '../modules/research/pipeline.js';
import type { PageRenderer } from '../modules/research/render.js';
import { createSearxngClient } from '../modules/research/search.js';
import { createResearchService, type ResearchService } from '../modules/research/service.js';
import { createProjectsService } from '../modules/projects/service.js';
import { createStatusService, type StatusService } from '../modules/status/service.js';
import { createCompareService } from '../modules/compare/service.js';
import { createTaskBreakdown } from '../modules/tasks/breakdown.js';
import { createTasksService, type TasksService } from '../modules/tasks/service.js';
import { createWorkerRelay, type WorkerRelay } from '../modules/worker/relay.js';
import { createWorkerHub } from '../modules/worker/routes.js';
import { createRolesService, type RolesService } from '../modules/roles/service.js';
import { createEventHub, type EventHub } from '../modules/runs/hub.js';
import { createRunObserver } from '../modules/runs/observer.js';
import { createRunner, type Runner } from '../modules/runs/runner.js';
import { createRunsService } from '../modules/runs/service.js';
import { createEventStore, type EventStore } from '../modules/runs/store.js';
import { unusedResearch, unusedSchedules } from './stubs.js';
import { createTestDatabase, type TestDatabase } from './db.js';

const READY = {
  status: 'ok' as const,
  checks: {
    postgres: { ok: true, latencyMs: 1 },
    hermes: { ok: true, latencyMs: 1 },
    ninerouter: { ok: true, latencyMs: 1 },
    searxng: { ok: true, latencyMs: 1 },
  },
};

export const OWNER_PASSWORD = 'correct-horse-battery';
export const AUTH_SECRET = 'rahasia-uji-'.padEnd(48, 'x');

export interface AuthEnv {
  app: FastifyInstance;
  database: TestDatabase;
  /** Jam palsu (ms epoch). Mengubah `clock.now` memajukan waktu untuk service dan JWT. */
  clock: { now: number };
  totpSecret: string;
  runner: Runner;
  roles: RolesService;
  routing: RoutingService;
  research: ResearchService;
  schedules: ScheduleService;
  projects: ReturnType<typeof createProjectsService>;
  tasks: TasksService;
  status: StatusService;
  workerRelay: WorkerRelay;
  push: PushService;
  /** pg-boss bersama (hanya ada bila riset atau jadwal dinyalakan). */
  boss: PgBoss | undefined;
  chat: ChatService;
  hub: EventHub;
  store: EventStore;
  /** Kode TOTP yang valid pada waktu sekarang menurut jam palsu. */
  code(): string;
  /** Login sebagai perangkat baru; jam dimajukan satu langkah TOTP agar kode tidak dianggap dipakai ulang. */
  login(
    opts?: Partial<{
      kind: DeviceKind;
      name: string;
      password: string;
      totp: string;
      ip: string;
      pushToken: string;
    }>,
  ): Promise<LightMyRequestResponse>;
  /** Login yang harus berhasil; mengembalikan respons yang sudah divalidasi. */
  loginOk(
    opts?: Parameters<AuthEnv['login']>[0],
  ): Promise<ReturnType<typeof LoginResponseSchema.parse>>;
  get(path: string, accessToken?: string): Promise<LightMyRequestResponse>;
  post(path: string, body: unknown, accessToken?: string): Promise<LightMyRequestResponse>;
  del(path: string, accessToken?: string): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function createAuthEnv(
  adminUrl: string,
  options: {
    owner?: boolean;
    /** Alamat 9Router tiruan. Default: port yang tidak mendengarkan. */
    ninerouterUrl?: string;
    /** API key gateway untuk 9Router tiruan. */
    ninerouterKey?: string;
    streamIdleMs?: number;
    /** Menyalakan layanan riset sungguhan (pg-boss) di database tes. */
    research?: {
      searxngUrl: string;
      depths?: Partial<Record<ResearchDepth, DepthConfig>>;
      renderer?: PageRenderer;
      log?: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
    };
    /** Menyalakan layanan jadwal sungguhan (pg-boss) di database tes. */
    schedules?: {
      pollMs?: number;
      missedCheckMs?: number;
      log?: {
        info: (obj: object, msg: string) => void;
        warn: (obj: object, msg: string) => void;
        error: (obj: object, msg: string) => void;
      };
    };
    /** Push FCM ke server FCM palsu. */
    push?: { baseUrl: string; account: ServiceAccount };
    /** Alamat Hermes tiruan. Default: port yang tidak mendengarkan. */
    hermesUrl?: string;
    hermesIdleMs?: number;
    heartbeatMs?: number;
    /** Masa tunggu relay worker (putus-sambung dan pembatalan) agar tes tidak menunggu puluhan detik. */
    workerRelay?: { disconnectGraceMs?: number; cancelGraceMs?: number };
    /** Batas run coding paralel per project untuk kartu kanban. */
    taskMaxParallel?: number;
    rateLimits?: Partial<RateLimits>;
    logStream?: NodeJS.WritableStream;
  } = {},
): Promise<AuthEnv> {
  const database = await createTestDatabase(adminUrl);
  const keys = deriveAuthKeys(AUTH_SECRET);
  const clock = { now: Date.UTC(2026, 9, 22, 6, 0, 0) };
  const now = () => clock.now;
  const totpSecret = generateTotpSecret();
  const { db } = database.handle;
  const client = createNineRouterClient({
    baseUrl: options.ninerouterUrl ?? 'http://127.0.0.1:9/v1',
    apiKey: options.ninerouterKey,
    timeoutMs: 5000,
    retryDelayMs: 0,
  });

  const roles = createRolesService();
  const hub = createEventHub(now);
  const store = createEventStore(db, hub);
  const projects = createProjectsService({ db });
  const workerHub = createWorkerHub();
  const workerRelay = createWorkerRelay({ hub: workerHub, projects });
  workerHub.onPresence((deviceId, online) => workerRelay.presence(deviceId, online));
  const observer = createRunObserver();
  const memory = createMemoryService({ db });
  const runner = createRunner({
    db,
    store,
    hub,
    observer,
    adapter: createHermesAdapter({
      baseUrl: options.hermesUrl ?? 'http://127.0.0.1:9',
      apiKey: 'kunci-hermes-uji',
      idleTimeoutMs: options.hermesIdleMs ?? 5000,
      connectTimeoutMs: 5000,
    }),
    workerAdapter: createWorkerRelayAdapter({
      relay: workerRelay,
      ...(options.workerRelay ?? {}),
    }),
    roles,
    memory,
  });
  const routing = createRoutingService({
    db,
    roles,
    complete: createRouterComplete(client, 'router-fast'),
  });
  const usage = createUsageRecorder(db);
  const boss =
    options.research || options.schedules
      ? new PgBoss({ connectionString: database.url, schema: 'pgboss', max: 3 })
      : undefined;
  await boss?.start();
  const research =
    options.research && boss
      ? createResearchService({
          db,
          store,
          hub,
          boss,
          llmFor: (runId) => createResearchLlm({ client, usage, runId: () => runId }),
          search: createSearxngClient({ baseUrl: options.research.searxngUrl }),
          // Server palsu tes ada di 127.0.0.1; produksi tidak punya jalan untuk membuka ini.
          fetchPage: createPageFetcher({ allowPrivateHosts: true, timeoutMs: 5000 }),
          renderer: options.research.renderer,
          models: { main: 'research-main', summary: 'general-cheap' },
          roles,
          now,
          ...(options.research.log ? { log: options.research.log } : {}),
          ...(options.research.depths ? { depths: options.research.depths } : {}),
        })
      : unusedResearch;
  if (options.research) await research.start();
  const files = createFilesService({ db });
  const spaces = createSpacesService({ db });
  const chat = createChatService({
    db,
    runner,
    files,
    titles: createTitleService({ client, model: 'router-fast' }),
    routing,
    roles,
    spaces,
    now,
  });
  const runs = createRunsService({ db, store, runner, hub, relay: workerRelay, chat, observer });
  const tasks = createTasksService({
    db,
    hub,
    chat,
    routing,
    roles,
    breakdown: createTaskBreakdown({
      complete: createRouterComplete(client, 'router-fast'),
      roles,
    }),
    ...(options.taskMaxParallel ? { maxParallel: options.taskMaxParallel } : {}),
  });
  observer.bind((runId) => tasks.runChanged(runId));
  const schedules =
    options.schedules && boss
      ? createScheduleService({
          db,
          boss,
          hub,
          chat,
          research,
          parser: createScheduleParser({
            complete: createRouterComplete(client, 'router-fast'),
            roles,
            now,
          }),
          roles,
          now,
          ...(options.schedules.pollMs ? { pollMs: options.schedules.pollMs } : {}),
          missedCheckMs: options.schedules.missedCheckMs ?? 0,
          ...(options.schedules.log ? { log: options.schedules.log } : {}),
        })
      : unusedSchedules;
  if (options.schedules) await schedules.start();
  const push = createPushService({
    db,
    hub,
    fcm: options.push
      ? createFcmClient({
          account: options.push.account,
          baseUrl: options.push.baseUrl,
          retryDelayMs: 0,
          now,
        })
      : undefined,
  });
  push.start();

  if (options.owner !== false) {
    await saveOwner(db, keys, { password: OWNER_PASSWORD, totpSecret }, now);
  }

  const status = createStatusService({
    db,
    health: { readiness: () => Promise.resolve(READY) },
    isWorkerOnline: (id) => workerHub.isOnline(id),
    queues: boss,
    now,
  });
  const app = buildApp({
    config: { LOG_LEVEL: options.logStream ? 'info' : 'silent', NODE_ENV: 'test' },
    health: { readiness: () => Promise.reject(new Error('tidak dipakai')) },
    auth: createAuthService({ db, keys, now }),
    devices: createDevicesService({ db, now }),
    llm: {
      client,
      models: createModelsService({ client, now }),
      quota: createQuotaService(db, now),
      usage,
      ...(options.streamIdleMs ? { streamIdleMs: options.streamIdleMs } : {}),
    },
    chat,
    files,
    runs,
    roles,
    routing,
    research,
    schedules,
    projects,
    tasks,
    compare: createCompareService({ client }),
    status,
    memory,
    spaces,
    worker: { hub: workerHub, relay: workerRelay },
    ws: {
      hub,
      store,
      exists: {
        run: (id) => runs.exists(id),
        conversation: (id) => chat.exists(id),
      },
      now,
      ...(options.heartbeatMs ? { heartbeatMs: options.heartbeatMs } : {}),
    },
    // Batas dilonggarkan agar tes yang sering login atau memantau status (polling tiap 20 ms) tidak terkena rate limit;
    // tes rate limit menimpanya.
    rateLimits: { login: 1000, refresh: 1000, general: 1_000_000, ...options.rateLimits },
    ...(options.logStream ? { logStream: options.logStream } : {}),
  });

  const code = () => totpCode(totpSecret, timeStep(clock.now));
  const headers = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});

  const login: AuthEnv['login'] = (opts = {}) => {
    clock.now += 30_000;
    return app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: opts.ip ? { 'x-forwarded-for': opts.ip } : {},
      payload: {
        password: opts.password ?? OWNER_PASSWORD,
        totp: opts.totp ?? code(),
        device: { name: opts.name ?? 'PC kerja', kind: opts.kind ?? 'desktop' },
        ...(opts.pushToken ? { pushToken: opts.pushToken } : {}),
      },
    });
  };

  return {
    app,
    database,
    clock,
    totpSecret,
    runner,
    roles,
    routing,
    research,
    schedules,
    projects,
    tasks,
    status,
    workerRelay,
    push,
    boss,
    chat,
    hub,
    store,
    code,
    login,
    async loginOk(opts) {
      const res = await login(opts);
      if (res.statusCode !== 200) throw new Error(`login gagal: ${res.statusCode} ${res.body}`);
      return LoginResponseSchema.parse(res.json());
    },
    get: (path, token) => app.inject({ method: 'GET', url: `/v1${path}`, headers: headers(token) }),
    post: (path, body, token) =>
      app.inject({
        method: 'POST',
        url: `/v1${path}`,
        headers: headers(token),
        payload: body as object,
      }),
    del: (path, token) =>
      app.inject({ method: 'DELETE', url: `/v1${path}`, headers: headers(token) }),
    async close() {
      push.close();
      await schedules.close().catch(() => undefined);
      await research.close().catch(() => undefined);
      await boss?.stop({ graceful: false, timeout: 5000 }).catch(() => undefined);
      await runner.idle();
      await tasks.idle();
      await chat.idle();
      await app.close();
      await database.drop();
    },
  };
}
