import { randomUUID } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { AppError, registerErrorHandling } from './errors.js';
import { authenticateHook } from './modules/auth/guard.js';
import { authRoutes, sessionRoutes } from './modules/auth/routes.js';
import type { AuthService } from './modules/auth/service.js';
import { chatRoutes } from './modules/chat/routes.js';
import { fileRoutes } from './modules/files/routes.js';
import type { FilesService } from './modules/files/service.js';
import { statusRoutes } from './modules/status/routes.js';
import type { StatusService } from './modules/status/service.js';
import { compareRoutes } from './modules/compare/routes.js';
import type { CompareService } from './modules/compare/service.js';
import type { ChatService } from './modules/chat/service.js';
import { deviceRoutes } from './modules/devices/routes.js';
import type { DevicesService } from './modules/devices/service.js';
import { healthRoutes } from './modules/health/routes.js';
import type { HealthService } from './modules/health/service.js';
import type { NineRouterClient } from './modules/llm/client.js';
import type { ModelsService } from './modules/llm/models.js';
import { LLM_PREFIX, llmProxyRoutes } from './modules/llm/proxy.js';
import { catalogRoutes } from './modules/llm/routes.js';
import type { QuotaService, UsageRecorder } from './modules/llm/usage.js';
import { routerRoutes } from './modules/router/routes.js';
import type { RoutingService } from './modules/router/service.js';
import { projectRoutes } from './modules/projects/routes.js';
import type { ProjectsService } from './modules/projects/service.js';
import { taskRoutes } from './modules/tasks/routes.js';
import type { TasksService } from './modules/tasks/service.js';
import type { WorkerRelay } from './modules/worker/relay.js';
import { workerRoutes, type createWorkerHub } from './modules/worker/routes.js';
import { researchRoutes } from './modules/research/routes.js';
import type { ResearchService } from './modules/research/service.js';
import { scheduleRoutes } from './modules/schedules/routes.js';
import type { ScheduleService } from './modules/schedules/service.js';
import { memoryRoutes } from './modules/memory/routes.js';
import type { MemoryService } from './modules/memory/service.js';
import { roleRoutes } from './modules/roles/routes.js';
import type { RolesService } from './modules/roles/service.js';
import type { RunsService } from './modules/runs/service.js';
import { MAX_MESSAGE_BYTES, wsRoutes, type WsDeps } from './modules/ws/routes.js';

export const API_PREFIX = '/v1';

/** Header request ID dari proxy hanya dipakai bila bentuknya aman untuk log. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Batas per menit (SECURITY_OPS.md): login 5 per IP, API umum 120 per perangkat. */
export interface RateLimits {
  login: number;
  refresh: number;
  general: number;
}
export const DEFAULT_RATE_LIMITS: RateLimits = { login: 5, refresh: 20, general: 120 };

export interface AppDeps {
  config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>;
  health: HealthService;
  auth: AuthService;
  devices: DevicesService;
  llm: {
    client: NineRouterClient;
    models: ModelsService;
    quota: QuotaService;
    usage: UsageRecorder;
    /** Diam selama ini (ms) berarti stream model dianggap macet. */
    streamIdleMs?: number;
  };
  chat: ChatService;
  files: FilesService;
  runs: RunsService;
  roles: RolesService;
  routing: RoutingService;
  research: ResearchService;
  schedules: ScheduleService;
  projects: ProjectsService;
  tasks: TasksService;
  compare: CompareService;
  status: StatusService;
  memory: MemoryService;
  /** Hub koneksi worker dan relay-nya; dibuat di luar karena runner juga memakai relay. */
  worker: { hub: ReturnType<typeof createWorkerHub>; relay: WorkerRelay };
  /** WebSocket /v1/ws; `auth` diisi dari dependensi di atas. */
  ws: Omit<WsDeps, 'auth'>;
  rateLimits?: Partial<RateLimits>;
  /** Tujuan log selain stdout; dipakai tes. */
  logStream?: NodeJS.WritableStream;
}

export function buildApp({
  config,
  health,
  auth,
  devices,
  llm,
  chat,
  files,
  runs,
  roles,
  routing,
  research,
  schedules,
  projects,
  tasks,
  compare,
  status,
  memory,
  worker,
  ws,
  rateLimits,
  logStream,
}: AppDeps): FastifyInstance {
  const limits = { ...DEFAULT_RATE_LIMITS, ...rateLimits };
  const { hub: workerHub, relay: workerRelay } = worker;
  const loggerOptions: FastifyServerOptions['logger'] = {
    level: config.LOG_LEVEL,
    // Log tidak pernah memuat token, cookie, atau isi .env (SECURITY_OPS.md).
    redact: {
      paths: [
        'headers.authorization',
        'headers.cookie',
        '*.headers.authorization',
        '*.headers.cookie',
        '*.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
    ...(logStream ? { stream: logStream } : {}),
  };

  const app = Fastify({
    logger: loggerOptions,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    requestIdHeader: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
    },
    bodyLimit: 1024 * 1024,
    // nginx berjalan di host yang sama; hanya dia yang boleh mengisi X-Forwarded-For.
    trustProxy: ['127.0.0.1', '::1'],
  });

  app.addHook('onRequest', async (req, reply) => {
    void reply.header('x-request-id', req.id);
  });

  registerErrorHandling(app);

  // Berjalan di preHandler, setelah autentikasi, sehingga batas umum dihitung per perangkat.
  void app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: limits.general,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.auth?.deviceId ?? req.ip,
    errorResponseBuilder: (_req, ctx) =>
      new AppError(
        429,
        'rate_limited',
        `Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(ctx.ttl / 1000)} detik.`,
      ),
  });

  void app.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });

  void app.register(
    async (v1) => {
      await v1.register(healthRoutes, { health });
      await v1.register(authRoutes, { auth, limits });
      await v1.register(async (protectedScope) => {
        protectedScope.addHook('onRequest', authenticateHook(auth));
        await protectedScope.register(sessionRoutes, { auth });
        await protectedScope.register(deviceRoutes, { devices });
        await protectedScope.register(catalogRoutes, { models: llm.models, quota: llm.quota });
        await protectedScope.register(chatRoutes, { chat, runs });
        await protectedScope.register(fileRoutes, { files });
        await protectedScope.register(roleRoutes, { roles });
        await protectedScope.register(routerRoutes, { routing });
        await protectedScope.register(researchRoutes, { research });
        await protectedScope.register(scheduleRoutes, { schedules });
        await protectedScope.register(projectRoutes, { projects });
        await protectedScope.register(taskRoutes, { tasks });
        await protectedScope.register(compareRoutes, { compare });
        await protectedScope.register(statusRoutes, { status });
        await protectedScope.register(memoryRoutes, { memory });
        await protectedScope.register(wsRoutes, { ...ws, auth });
        await protectedScope.register(workerRoutes, {
          auth,
          onRunEvent: (deviceId, runId, event) => workerRelay.feed(deviceId, runId, event),
          onReviewResult: (deviceId, frame) => workerRelay.reviewResult(deviceId, frame),
          hub: workerHub,
          ...(ws.heartbeatMs ? { heartbeatMs: ws.heartbeatMs } : {}),
          ...(ws.now ? { now: ws.now } : {}),
        });
      });
    },
    { prefix: API_PREFIX },
  );

  void app.register(llmProxyRoutes, {
    prefix: LLM_PREFIX,
    auth,
    client: llm.client,
    usage: llm.usage,
    ...(llm.streamIdleMs ? { streamIdleMs: llm.streamIdleMs } : {}),
  });

  return app;
}
