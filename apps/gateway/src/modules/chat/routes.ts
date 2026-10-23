import {
  CreateConversationRequestSchema,
  IdParamsSchema,
  ListConversationsQuerySchema,
  PageQuerySchema,
  RerouteRequestSchema,
  RunEventsQuerySchema,
  SendMessageRequestSchema,
  UpdateConversationRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
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

  app.patch('/conversations/:id', guard, (req) =>
    chat.updateConversation(
      IdParamsSchema.parse(req.params).id,
      UpdateConversationRequestSchema.parse(req.body),
    ),
  );

  app.delete('/conversations/:id', guard, async (req, reply) => {
    await chat.archiveConversation(IdParamsSchema.parse(req.params).id);
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

  app.get('/runs/:id', guard, (req) => runs.get(IdParamsSchema.parse(req.params).id));

  app.get('/runs/:id/events', guard, (req) => {
    const q = RunEventsQuerySchema.parse(req.query);
    return runs.events(IdParamsSchema.parse(req.params).id, q.afterSeq, q.limit);
  });

  app.post('/runs/:id/cancel', guard, (req) => runs.cancel(IdParamsSchema.parse(req.params).id));

  done();
};
