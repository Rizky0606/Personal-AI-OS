import { IdSchema, RUN_ID_HEADER } from '@aios/contracts';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../errors.js';
import { requireAuth } from '../auth/guard.js';
import type { ProjectsService } from '../projects/service.js';
import type { RunsService } from '../runs/service.js';

/** Run yang sedang berjalan dan benar-benar milik worker yang memanggil. */
export interface WorkerRun {
  runId: string;
  projectId: string;
  conversationId: string | null;
  planOnly: boolean;
  model: string;
  deviceId: string;
}

export interface RunBindingDeps {
  runs: Pick<RunsService, 'get' | 'projectId'>;
  projects: Pick<ProjectsService, 'workerOf'>;
}

/**
 * Pengikatan run untuk principal `worker` di jalur MCP (`/v1/mcp` dan `/v1/mcp/connector/:id`): header
 * `X-Aios-Run-Id` disisipkan relay worker (bukan omp), run harus milik project yang terikat ke perangkat itu
 * dan sedang berjalan. Pola yang sama dengan unggah screenshot (`modules/worker/artifacts.ts`).
 */
export async function requireWorkerRun(
  req: FastifyRequest,
  deps: RunBindingDeps,
): Promise<WorkerRun> {
  const auth = requireAuth(req);
  const header = req.headers[RUN_ID_HEADER];
  if (header === undefined)
    throw new AppError(400, 'missing_run_id', `Header ${RUN_ID_HEADER} wajib ada.`);
  const parsedRun = IdSchema.safeParse(header);
  if (!parsedRun.success)
    throw new AppError(400, 'invalid_run_id', `Header ${RUN_ID_HEADER} harus berisi ID run.`);
  const runId = parsedRun.data;
  const projectId = await deps.runs.projectId(runId);
  if (!projectId || (await deps.projects.workerOf(projectId)) !== auth.deviceId)
    throw new AppError(403, 'run_not_owned', 'Run ini bukan milik worker ini.');
  const run = await deps.runs.get(runId);
  if (run.status !== 'running')
    throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
  return {
    runId,
    projectId,
    conversationId: run.conversationId,
    planOnly: run.planOnly,
    model: run.model ?? run.engine,
    deviceId: auth.deviceId,
  };
}
