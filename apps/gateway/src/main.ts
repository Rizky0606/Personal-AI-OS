import { createHermesAdapter, createWorkerRelayAdapter } from '@aios/adapters';
import { RegistryError } from '@aios/roles';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createLinkReader } from './modules/chat/links.js';
import { createChatService } from './modules/chat/service.js';
import { createWebContext } from './modules/chat/web.js';
import { createFilesService } from './modules/files/service.js';
import { createTitleService } from './modules/chat/title.js';
import { createAuthService } from './modules/auth/service.js';
import { deriveAuthKeys } from './modules/auth/secrets.js';
import { createDevicesService } from './modules/devices/service.js';
import { createOutbox } from './modules/files/outbox.js';
import { createMemoryService } from './modules/memory/service.js';
import { createForkService } from './modules/fork/service.js';
import { createHandoffService } from './modules/handoff/service.js';
import { createOpinionService } from './modules/opinion/service.js';
import { createTemplateService } from './modules/templates/service.js';
import { createSearchService } from './modules/search/service.js';
import { createSpacesService } from './modules/spaces/service.js';
import { createHealthService } from './modules/health/service.js';
import { createNineRouterClient } from './modules/llm/client.js';
import { createModelsService } from './modules/llm/models.js';
import { createQuotaService, createUsageRecorder } from './modules/llm/usage.js';
import { createResearchLlm } from './modules/research/llm.js';
import { createPageFetcher } from './modules/research/fetcher.js';
import { createBrowserRenderer } from './modules/research/render.js';
import { createSearxngClient } from './modules/research/search.js';
import { createResearchService } from './modules/research/service.js';
import { createBoss } from './modules/queue/boss.js';
import { createFcmClient, loadServiceAccount } from './modules/push/fcm.js';
import { createPushService } from './modules/push/service.js';
import { createScheduleParser } from './modules/schedules/parser.js';
import { createScheduleService } from './modules/schedules/service.js';
import { createProjectsService } from './modules/projects/service.js';
import { createStatusService } from './modules/status/service.js';
import { createCompareService } from './modules/compare/service.js';
import { createTaskBreakdown } from './modules/tasks/breakdown.js';
import { createTasksService } from './modules/tasks/service.js';
import { createWorkerRelay } from './modules/worker/relay.js';
import { createWorkerHub } from './modules/worker/routes.js';
import { createRolesService } from './modules/roles/service.js';
import { createRouterComplete } from './modules/router/complete.js';
import { createRoutingService } from './modules/router/service.js';
import { createEventHub } from './modules/runs/hub.js';
import { createRunObserver } from './modules/runs/observer.js';
import { createRunner } from './modules/runs/runner.js';
import { createRunsService } from './modules/runs/service.js';
import { createEventStore } from './modules/runs/store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, pool, close } = createDb(config.DATABASE_URL);
  const keys = deriveAuthKeys(config.AUTH_SECRET);
  const client = createNineRouterClient({
    baseUrl: config.NINEROUTER_URL,
    apiKey: config.NINEROUTER_API_KEY,
  });

  const log = {
    warn: (obj: object, msg: string) => app.log.warn(obj, msg),
    error: (obj: object, msg: string) => app.log.error(obj, msg),
  };
  // Gagal start bila role merujuk skill yang tidak ada atau frontmatter salah; hot-reload hanya di mode dev.
  const roles = createRolesService({
    watch: config.NODE_ENV === 'development',
    log: {
      info: (obj, msg) => app.log.info(obj, msg),
      error: (obj, msg) => app.log.error(obj, msg),
    },
  });
  const boss = createBoss(config.DATABASE_URL, log);
  const hub = createEventHub();
  const store = createEventStore(db, hub);
  const projects = createProjectsService({ db });
  const workerHub = createWorkerHub();
  const workerRelay = createWorkerRelay({ hub: workerHub, projects });
  workerHub.onPresence((deviceId, online) => workerRelay.presence(deviceId, online));
  const observer = createRunObserver(log);
  const memory = createMemoryService({ db });
  const files = createFilesService({ db });
  const outbox =
    config.OUTBOX_DIR && config.OUTBOX_HOST_DIR
      ? createOutbox({
          dir: config.OUTBOX_DIR,
          hostDir: config.OUTBOX_HOST_DIR,
          save: (input) => files.saveGenerated(input),
          log,
        })
      : undefined;
  const runner = createRunner({
    db,
    store,
    hub,
    observer,
    adapter: createHermesAdapter({ baseUrl: config.HERMES_URL, apiKey: config.HERMES_API_KEY }),
    workerAdapter: createWorkerRelayAdapter({ relay: workerRelay }),
    roles,
    memory,
    projectRules: projects,
    ...(outbox ? { outbox } : {}),
    log,
  });
  const routing = createRoutingService({
    db,
    roles,
    complete: createRouterComplete(client, config.ROUTER_MODEL),
    log,
  });
  const spaces = createSpacesService({ db });
  // Satu pengambil halaman untuk riset dan pembacaan tautan di chat: aturan SSRF dan batas ukurannya sama.
  const fetchPage = createPageFetcher({ timeoutMs: 10_000 });
  const chat = createChatService({
    db,
    runner,
    files,
    titles: createTitleService({ client, model: config.TITLE_MODEL, log }),
    routing,
    roles,
    spaces,
    links: createLinkReader({ fetchPage }),
    web: createWebContext({
      search: createSearxngClient({ baseUrl: config.SEARXNG_URL }),
      fetchPage,
      complete: createRouterComplete(client, config.ROUTER_MODEL),
    }),
  });
  const runs = createRunsService({ db, store, runner, hub, relay: workerRelay, chat, observer });
  const tasks = createTasksService({
    db,
    hub,
    chat,
    routing,
    roles,
    breakdown: createTaskBreakdown({
      complete: createRouterComplete(client, config.TASK_MODEL),
      roles,
    }),
    maxParallel: config.TASK_MAX_PARALLEL,
    log,
  });
  observer.bind((runId) => tasks.runChanged(runId));
  const usage = createUsageRecorder(db);
  const research = createResearchService({
    db,
    store,
    hub,
    boss,
    llmFor: (runId) => createResearchLlm({ client, usage, runId: () => runId, log }),
    search: createSearxngClient({ baseUrl: config.SEARXNG_URL }),
    fetchPage,
    renderer: config.BROWSER_EXECUTABLE_PATH
      ? createBrowserRenderer({ executablePath: config.BROWSER_EXECUTABLE_PATH })
      : undefined,
    models: { main: config.RESEARCH_MODEL, summary: config.RESEARCH_SUMMARY_MODEL },
    roles,
    log,
  });

  const schedules = createScheduleService({
    db,
    boss,
    hub,
    chat,
    research,
    parser: createScheduleParser({
      complete: createRouterComplete(client, config.SCHEDULE_MODEL),
      roles,
    }),
    roles,
    log: { ...log, info: (obj, msg) => app.log.info(obj, msg) },
  });
  const push = createPushService({
    db,
    hub,
    fcm: config.FCM_SERVICE_ACCOUNT_FILE
      ? createFcmClient({ account: loadServiceAccount(config.FCM_SERVICE_ACCOUNT_FILE), log })
      : undefined,
    log: { ...log, info: (obj, msg) => app.log.info(obj, msg) },
  });

  const health = createHealthService({ config, pingDatabase: () => pool.query('select 1') });
  const app = buildApp({
    config,
    health,
    auth: createAuthService({ db, keys, log: { warn: (obj, msg) => app.log.warn(obj, msg) } }),
    devices: createDevicesService({ db }),
    llm: {
      client,
      models: createModelsService({ client, log: { warn: (obj, msg) => app.log.warn(obj, msg) } }),
      quota: createQuotaService(db),
      usage,
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
    memory,
    templates: createTemplateService({ db }),
    opinion: createOpinionService({ client }),
    handoff: createHandoffService({ db, client }),
    fork: createForkService({ db }),
    spaces,
    search: createSearchService({ db }),
    status: createStatusService({
      db,
      health,
      isWorkerOnline: (id) => workerHub.isOnline(id),
      queues: boss,
    }),
    worker: { hub: workerHub, relay: workerRelay },
    ws: {
      hub,
      store,
      exists: {
        run: (id) => runs.exists(id),
        conversation: (id) => chat.exists(id),
      },
    },
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, 'menghentikan gateway');
    await app.close();
    push.close();
    await schedules.close();
    await research.close();
    await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
    roles.close();
    await close();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await boss.start();
  await research.start();
  await schedules.start();
  push.start();
  const recovered = await runner.recoverOrphans();
  if (recovered > 0) app.log.warn({ recovered }, 'run tertinggal ditandai gagal setelah restart');
  await tasks.start();

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err: unknown) => {
  // ConfigError sudah berisi pesan yang aman (nama variabel, bukan nilai).
  const known = err instanceof ConfigError || err instanceof RegistryError;
  console.error(known ? err.message : 'Gateway gagal start.');
  if (!known && err instanceof Error) console.error(err.stack);
  process.exit(1);
});
