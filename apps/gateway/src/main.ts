import { createHermesAdapter } from '@aios/adapters';
import { RegistryError } from '@aios/roles';
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createChatService } from './modules/chat/service.js';
import { createTitleService } from './modules/chat/title.js';
import { createAuthService } from './modules/auth/service.js';
import { deriveAuthKeys } from './modules/auth/secrets.js';
import { createDevicesService } from './modules/devices/service.js';
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
import { createRolesService } from './modules/roles/service.js';
import { createRouterComplete } from './modules/router/complete.js';
import { createRoutingService } from './modules/router/service.js';
import { createEventHub } from './modules/runs/hub.js';
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
  const runner = createRunner({
    db,
    store,
    hub,
    adapter: createHermesAdapter({ baseUrl: config.HERMES_URL, apiKey: config.HERMES_API_KEY }),
    roles,
    log,
  });
  const routing = createRoutingService({
    db,
    roles,
    complete: createRouterComplete(client, config.ROUTER_MODEL),
    log,
  });
  const chat = createChatService({
    db,
    runner,
    titles: createTitleService({ client, model: config.TITLE_MODEL, log }),
    routing,
    roles,
  });
  const runs = createRunsService({ db, store, runner });
  const usage = createUsageRecorder(db);
  const research = createResearchService({
    db,
    store,
    hub,
    boss,
    llmFor: (runId) => createResearchLlm({ client, usage, runId: () => runId, log }),
    search: createSearxngClient({ baseUrl: config.SEARXNG_URL }),
    fetchPage: createPageFetcher(),
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

  const app = buildApp({
    config,
    health: createHealthService({ config, pingDatabase: () => pool.query('select 1') }),
    auth: createAuthService({ db, keys, log: { warn: (obj, msg) => app.log.warn(obj, msg) } }),
    devices: createDevicesService({ db }),
    llm: {
      client,
      models: createModelsService({ client, log: { warn: (obj, msg) => app.log.warn(obj, msg) } }),
      quota: createQuotaService(db),
      usage,
    },
    chat,
    runs,
    roles,
    routing,
    research,
    schedules,
    projects: createProjectsService({ db }),
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

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err: unknown) => {
  // ConfigError sudah berisi pesan yang aman (nama variabel, bukan nilai).
  const known = err instanceof ConfigError || err instanceof RegistryError;
  console.error(known ? err.message : 'Gateway gagal start.');
  if (!known && err instanceof Error) console.error(err.stack);
  process.exit(1);
});
