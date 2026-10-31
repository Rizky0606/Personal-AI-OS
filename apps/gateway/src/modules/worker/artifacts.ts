import { randomUUID } from 'node:crypto';
import { IdSchema, ArtifactCreatedEventSchema } from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { AppError } from '../../errors.js';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { EventStore } from '../runs/store.js';
import type { Runner } from '../runs/runner.js';
import type { RunsService } from '../runs/service.js';
import type { ProjectsService } from '../projects/service.js';
import type { FilesService } from '../files/service.js';

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function parseScreenshotUpload(
  bytes: Buffer,
  metadata: string | undefined,
): { runId: string } {
  if (bytes.length > MAX_SCREENSHOT_BYTES)
    throw new AppError(413, 'screenshot_too_large', 'Screenshot terlalu besar.');
  if (bytes.length < PNG.length || !bytes.subarray(0, PNG.length).equals(PNG))
    throw new AppError(400, 'invalid_png', 'Screenshot harus berupa PNG.');
  let value: unknown;
  try {
    value = JSON.parse(metadata ?? '');
  } catch {
    throw new AppError(400, 'invalid_metadata', 'Metadata screenshot tidak valid.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError(400, 'invalid_metadata', 'Metadata screenshot tidak valid.');
  const metadataObject = value as Record<string, unknown>;
  if (Object.keys(metadataObject).length !== 1 || typeof metadataObject.runId !== 'string')
    throw new AppError(400, 'invalid_metadata', 'Metadata screenshot tidak valid.');
  const parsed = IdSchema.safeParse(metadataObject.runId);
  if (!parsed.success)
    throw new AppError(400, 'invalid_metadata', 'Metadata screenshot tidak valid.');
  return { runId: parsed.data };
}

export interface WorkerArtifactDeps {
  files: FilesService;
  runs: RunsService;
  runner: Pick<Runner, 'isActive'>;
  projects: Pick<ProjectsService, 'workerOf'>;
  store: EventStore;
}

export const workerArtifactRoutes: FastifyPluginCallback<WorkerArtifactDeps> = (
  app,
  deps,
  done,
) => {
  app.addContentTypeParser(
    'image/png',
    { parseAs: 'buffer', bodyLimit: MAX_SCREENSHOT_BYTES },
    (_req, body, next) => next(null, body),
  );
  app.post(
    '/worker/artifacts/screenshot',
    { onRequest: requireScope('worker'), bodyLimit: MAX_SCREENSHOT_BYTES },
    async (req, reply) => {
      const body = req.body;
      if (!Buffer.isBuffer(body)) throw new AppError(400, 'invalid_upload', 'Kirim PNG mentah.');
      const { runId } = parseScreenshotUpload(
        body,
        typeof req.headers['x-aios-metadata'] === 'string'
          ? req.headers['x-aios-metadata']
          : undefined,
      );
      const auth = requireAuth(req);
      const projectId = await deps.runs.projectId(runId);
      if (!projectId || (await deps.projects.workerOf(projectId)) !== auth.deviceId)
        throw new AppError(403, 'run_not_owned', 'Run ini bukan milik worker ini.');
      if (!deps.runner.isActive(runId))
        throw new AppError(409, 'run_not_active', 'Run ini tidak sedang berjalan di gateway.');
      const record = await deps.files.saveGenerated({
        name: `screenshot-${randomUUID()}.png`,
        bytes: body,
      });
      const event = ArtifactCreatedEventSchema.parse({
        type: 'artifact.created',
        fileId: record.id,
        name: record.name,
        mime: record.mime,
        size: record.size,
        sha256: record.sha256,
        source: 'screenshot',
      });
      await deps.store.append(runId, event);
      return reply.code(201).send(record);
    },
  );
  done();
};
