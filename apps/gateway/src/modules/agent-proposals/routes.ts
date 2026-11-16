import {
  AgentProposalListSchema,
  AgentProposalQuerySchema,
  ApproveAgentProposalRequestSchema,
  IdParamsSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { AgentProposalService } from './service.js';

/** Tinjau usulan kartu dan jadwal dari agent: hanya klien aplikasi (scope `app`). */
export const agentProposalRoutes: FastifyPluginCallback<{ proposals: AgentProposalService }> = (
  app,
  { proposals },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/agent-proposals', guard, async (req) =>
    AgentProposalListSchema.parse({
      items: await proposals.list(AgentProposalQuerySchema.parse(req.query)),
    }),
  );

  app.get('/agent-proposals/:id', guard, (req) =>
    proposals.get(IdParamsSchema.parse(req.params).id),
  );

  app.post('/agent-proposals/:id/approve', guard, (req) =>
    proposals.approve(
      IdParamsSchema.parse(req.params).id,
      ApproveAgentProposalRequestSchema.parse(req.body ?? {}),
      requireAuth(req).deviceId,
    ),
  );

  app.post('/agent-proposals/:id/reject', guard, (req) =>
    proposals.reject(IdParamsSchema.parse(req.params).id, requireAuth(req).deviceId),
  );

  done();
};
