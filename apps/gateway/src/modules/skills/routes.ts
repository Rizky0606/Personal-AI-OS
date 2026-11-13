import {
  ApproveSkillProposalRequestSchema,
  CreateSkillRequestSchema,
  HermesSkillListSchema,
  RejectSkillProposalRequestSchema,
  SkillCuratorReportResponseSchema,
  SkillCuratorReportSchema,
  SkillProposalDetailSchema,
  SkillProposalListSchema,
  SkillProposalSchema,
  HermesSkillPreviewSchema,
  PreviewHermesSkillRequestSchema,
  ImportHermesSkillRequestSchema,
  InstallSkillRequestSchema,
  PreviewSkillInstallRequestSchema,
  SkillInstallPreviewSchema,
  RestoreSkillRequestSchema,
  ScanSkillRequestSchema,
  SetSkillStatusRequestSchema,
  SkillDetailSchema,
  SkillEngineSchema,
  SkillListSchema,
  SkillSaveResultSchema,
  SkillScanSchema,
  SkillVersionListSchema,
  UpdateSkillRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors.js';
import { requireAnyScope, requireScope } from '../auth/guard.js';
import type { SkillCurator } from './curator.js';
import type { InstallService } from './install-service.js';
import type { SkillChange, SkillManager } from './manager.js';
import type { ProposalService } from './proposal-service.js';
import type { SkillsService } from './service.js';

const ProposalListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  conversationId: z.string().optional(),
});

const ListQuery = z.object({
  include: z.enum(['active', 'all']).optional(),
  engine: SkillEngineSchema.optional(),
});

/**
 * Katalog skill (P9) dan pengelolaannya (P10). Membaca: scope `app` atau `worker` (klien menampilkan, worker
 * mengunduh isi skill ke folder omp-nya; worker hanya melihat skill yang AKTIF). Mengubah: hanya scope `app`.
 * Pengunduhan dari luar dilakukan gateway, tidak pernah dari klien.
 */
export const skillRoutes: FastifyPluginCallback<{
  skills: SkillsService;
  manager?: SkillManager;
  installer?: InstallService;
  proposals?: ProposalService;
  curator?: SkillCurator;
}> = (
  app,
  {
    skills,
    manager: optionalManager,
    installer: optionalInstaller,
    proposals: optionalProposals,
    curator: optionalCurator,
  },
  done,
) => {
  const prop = (): ProposalService => {
    if (!optionalProposals) throw unavailable();
    return optionalProposals;
  };
  const cur = (): SkillCurator => {
    if (!optionalCurator) throw unavailable();
    return optionalCurator;
  };
  const inst = (): InstallService => {
    if (!optionalInstaller) throw unavailable();
    return optionalInstaller;
  };
  const unavailable = () => new AppError(503, 'skills_unavailable', 'Pengelola skill tidak aktif.');
  const m = (): SkillManager => {
    if (!optionalManager) throw unavailable();
    return optionalManager;
  };
  const saved = (change: SkillChange) => {
    const skill = skills.get(change.id);
    if (!skill) throw new AppError(404, 'skill_not_found', `Skill "${change.id}" tidak ada.`);
    return SkillSaveResultSchema.parse({
      ...skill,
      scan: change.scan,
      hermesSync: change.hermesSync,
    });
  };

  app.get('/skills', { onRequest: requireAnyScope('app', 'worker') }, (req) => {
    const query = ListQuery.parse(req.query);
    // Worker tidak boleh melihat skill nonaktif/arsip.
    const include = req.auth?.scopes.includes('app') ? (query.include ?? 'active') : 'active';
    return SkillListSchema.parse({ items: skills.list({ include, engine: query.engine }) });
  });

  app.post('/skills/scan', { onRequest: requireScope('app') }, (req) => {
    const input = ScanSkillRequestSchema.parse(req.body);
    return SkillScanSchema.parse(m().scan(input));
  });

  app.post('/skills/install/preview', { onRequest: requireScope('app') }, async (req) =>
    SkillInstallPreviewSchema.parse(
      await inst().preview(PreviewSkillInstallRequestSchema.parse(req.body).source),
    ),
  );

  app.post('/skills/install', { onRequest: requireScope('app') }, async (req, reply) => {
    const change = await inst().install(InstallSkillRequestSchema.parse(req.body));
    return reply.code(201).send(saved(change));
  });

  app.get('/skills/hermes', { onRequest: requireScope('app') }, async () =>
    HermesSkillListSchema.parse(await inst().listHermes()),
  );

  app.post('/skills/hermes/preview', { onRequest: requireScope('app') }, async (req) =>
    HermesSkillPreviewSchema.parse(
      await inst().previewHermes(PreviewHermesSkillRequestSchema.parse(req.body)),
    ),
  );

  app.get('/skills/proposals', { onRequest: requireScope('app') }, async (req) =>
    SkillProposalListSchema.parse({
      items: await prop().list(ProposalListQuery.parse(req.query)),
    }),
  );

  app.get<{ Params: { id: string } }>(
    '/skills/proposals/:id',
    { onRequest: requireScope('app') },
    async (req) => SkillProposalDetailSchema.parse(await prop().get(req.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    '/skills/proposals/:id/approve',
    { onRequest: requireScope('app') },
    async (req) =>
      saved(
        await prop().approve(
          req.params.id,
          ApproveSkillProposalRequestSchema.parse(req.body ?? {}),
        ),
      ),
  );

  app.post<{ Params: { id: string } }>(
    '/skills/proposals/:id/reject',
    { onRequest: requireScope('app') },
    async (req) =>
      SkillProposalSchema.parse(
        await prop().reject(
          req.params.id,
          RejectSkillProposalRequestSchema.parse(req.body ?? {}).reason,
        ),
      ),
  );

  app.get('/skills/curator/report', { onRequest: requireScope('app') }, async () =>
    SkillCuratorReportResponseSchema.parse({ report: await cur().latest() }),
  );

  app.post('/skills/curator/run', { onRequest: requireScope('app') }, async () =>
    SkillCuratorReportSchema.parse(await cur().runOnce()),
  );

  app.post('/skills/hermes/import', { onRequest: requireScope('app') }, async (req, reply) => {
    const change = await inst().importHermes(ImportHermesSkillRequestSchema.parse(req.body));
    return reply.code(201).send(saved(change));
  });

  app.get<{ Params: { id: string } }>(
    '/skills/:id',
    { onRequest: requireAnyScope('app', 'worker') },
    (req) => {
      const skill = skills.get(req.params.id);
      const hidden = skill && skill.status !== 'active' && !req.auth?.scopes.includes('app');
      if (!skill || hidden)
        throw new AppError(404, 'skill_not_found', `Skill "${req.params.id}" tidak ada.`);
      return SkillDetailSchema.parse(skill);
    },
  );

  app.post('/skills', { onRequest: requireScope('app') }, async (req, reply) => {
    const change = await m().create(CreateSkillRequestSchema.parse(req.body));
    return reply.code(201).send(saved(change));
  });

  app.patch<{ Params: { id: string } }>(
    '/skills/:id',
    { onRequest: requireScope('app') },
    async (req) => saved(await m().update(req.params.id, UpdateSkillRequestSchema.parse(req.body))),
  );

  app.delete<{ Params: { id: string } }>(
    '/skills/:id',
    { onRequest: requireScope('app') },
    async (req, reply) => {
      await m().remove(req.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/skills/:id/status',
    { onRequest: requireScope('app') },
    async (req) => {
      const { status } = SetSkillStatusRequestSchema.parse(req.body);
      return saved(await m().setStatus(req.params.id, status));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/skills/:id/versions',
    { onRequest: requireScope('app') },
    async (req) => SkillVersionListSchema.parse({ items: await m().versions(req.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    '/skills/:id/restore',
    { onRequest: requireScope('app') },
    async (req) => {
      const { version } = RestoreSkillRequestSchema.parse(req.body);
      return saved(await m().restore(req.params.id, version));
    },
  );
  done();
};
