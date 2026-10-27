import {
  ApprovalDecisionRequestSchema,
  ApprovalParamsSchema,
  CreateConversationRequestSchema,
  DeleteConversationQuerySchema,
  IdParamsSchema,
  ListConversationsQuerySchema,
  ListRunsQuerySchema,
  PageQuerySchema,
  RerouteRequestSchema,
  ReviewRequestSchema,
  RunEventsQuerySchema,
  SendMessageRequestSchema,
  SteerRequestSchema,
  UpdateConversationRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireAuth, requireScope } from '../auth/guard.js';
import type { RunsService } from '../runs/service.js';
import type { ChatService } from './service.js';

const MessagesQuerySchema = PageQuerySchema.pick({ before: true, limit: true });

/** Percakapan, pesan, dan run dipakai klien aplikasi: scope `app`. */
export const chatRoutes: FastifyPluginCallback<{ chat: ChatService; runs: RunsService }> = (
  app,
  { chat, runs },
  done,
) => {
  const guard = { onRequest: requireScope('app') };

  app.get('/conversations', guard, (req) =>
    chat.listConversations(ListConversationsQuerySchema.parse(req.query)),
  );

  app.post('/conversations', guard, async (req, reply) =>
    reply
      .code(201)
      .send(await chat.createConversation(CreateConversationRequestSchema.parse(req.body))),
  );

  app.get('/conversations/:id', guard, (req) =>
    chat.getConversation(IdParamsSchema.parse(req.params).id),
  );

  app.patch('/conversations/:id', guard, (req) =>
    chat.updateConversation(
      IdParamsSchema.parse(req.params).id,
      UpdateConversationRequestSchema.parse(req.body),
    ),
  );

  app.delete('/conversations/:id', guard, async (req, reply) => {
    const { id } = IdParamsSchema.parse(req.params);
    const { permanent } = DeleteConversationQuerySchema.parse(req.query);
    if (permanent === 'true') await chat.deleteConversation(id);
    else await chat.archiveConversation(id);
    return reply.code(204).send();
  });

  app.get('/conversations/:id/messages', guard, (req) =>
    chat.listMessages(IdParamsSchema.parse(req.params).id, MessagesQuerySchema.parse(req.query)),
  );

  app.post('/conversations/:id/messages', guard, async (req, reply) =>
    reply
      .code(201)
      .send(
        await chat.sendMessage(
          IdParamsSchema.parse(req.params).id,
          SendMessageRequestSchema.parse(req.body),
        ),
      ),
  );

  app.post('/messages/:id/reroute', guard, async (req, reply) =>
    reply
      .code(201)
      .send(
        await chat.reroute(
          IdParamsSchema.parse(req.params).id,
          RerouteRequestSchema.parse(req.body),
        ),
      ),
  );

  app.post('/messages/:id/edit', guard, async (req, reply) =>
    reply
      .code(201)
      .send(
        await chat.editMessage(
          IdParamsSchema.parse(req.params).id,
          SendMessageRequestSchema.parse(req.body),
        ),
      ),
  );

  app.delete('/messages/:id', guard, async (req, reply) => {
    await chat.deleteMessage(IdParamsSchema.parse(req.params).id);
    return reply.code(204).send();
  });

  app.get('/runs/:id', guard, (req) => runs.get(IdParamsSchema.parse(req.params).id));

  app.get('/runs', guard, (req) => runs.list(ListRunsQuerySchema.parse(req.query)));

  app.get('/runs/:id/events', guard, (req) => {
    const q = RunEventsQuerySchema.parse(req.query);
    return runs.events(IdParamsSchema.parse(req.params).id, q.afterSeq, q.limit);
  });

  app.post('/runs/:id/cancel', guard, (req) => runs.cancel(IdParamsSchema.parse(req.params).id));

  app.post('/runs/:id/review', guard, (req) =>
    runs.review(
      requireAuth(req).deviceId,
      IdParamsSchema.parse(req.params).id,
      ReviewRequestSchema.parse(req.body),
    ),
  );

  app.post('/runs/:id/steer', guard, async (req, reply) => {
    const { id } = IdParamsSchema.parse(req.params);
    await runs.steer(id, SteerRequestSchema.parse(req.body).text);
    return reply.code(204).send();
  });

  app.post('/runs/:id/approvals/:approvalId', guard, (req) => {
    const { id, approvalId } = ApprovalParamsSchema.parse(req.params);
    return runs.resolveApproval(
      requireAuth(req).deviceId,
      id,
      approvalId,
      ApprovalDecisionRequestSchema.parse(req.body),
    );
  });

  done();
};
