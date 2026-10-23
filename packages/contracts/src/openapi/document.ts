import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';
import { endpoints } from '../api.js';
import { PROBLEM_CONTENT_TYPE, ProblemSchema } from '../common.js';
import * as entities from '../entities.js';
import { AgentEventSchema, ServerEventSchema, UserEventSchema } from '../events.js';
import { RunStatusSchema } from '../run-status.js';
import { ChannelSchema, ClientMessageSchema, EventEnvelopeSchema } from '../ws.js';
import { WorkerCommandSchema, WorkerEventFrameSchema } from '../worker.js';

export const API_VERSION = '1.0.0';

const ERROR_TITLES: Record<number, string> = {
  400: 'Permintaan tidak valid',
  401: 'Belum login atau token tidak berlaku',
  403: 'Token tidak punya scope yang dibutuhkan',
  404: 'Tidak ditemukan',
  409: 'Konflik dengan status saat ini',
  413: 'Berkas terlalu besar',
  422: 'Tidak bisa diproses',
  429: 'Terlalu banyak permintaan',
  502: 'Layanan model (9Router) gagal atau tidak terjangkau',
  503: 'Layanan sementara tidak tersedia',
};

/** Skema yang tidak muncul di REST tetapi dipakai klien (WebSocket, event, worker). */
const standaloneSchemas: z.ZodType[] = [
  AgentEventSchema,
  UserEventSchema,
  ServerEventSchema,
  ChannelSchema,
  EventEnvelopeSchema,
  ClientMessageSchema,
  WorkerCommandSchema,
  WorkerEventFrameSchema,
  RunStatusSchema,
  entities.ApprovalRuleSchema,
  entities.AuditLogSchema,
  entities.RoutingDecisionSchema,
];

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  for (const e of endpoints) {
    const responses: Record<string, unknown> = {};
    for (const r of e.responses) {
      const key = String(r.status);
      const existing = responses[key] as { content?: Record<string, unknown> } | undefined;
      const content = r.schema
        ? { [r.contentType ?? 'application/json']: { schema: r.schema } }
        : undefined;
      if (existing && content) {
        existing.content = { ...existing.content, ...content };
      } else {
        responses[key] = { description: r.description, ...(content ? { content } : {}) };
      }
    }
    // Endpoint terproteksi selalu bisa menjawab 401 (token), 403 (scope), dan 429 (batas per perangkat).
    const errorStatuses = new Set([...e.errors, ...(e.auth ? [401, 403, 429] : [])]);
    for (const status of [...errorStatuses].sort((a, b) => a - b)) {
      responses[String(status)] = {
        description: ERROR_TITLES[status] ?? 'Error',
        content: { [PROBLEM_CONTENT_TYPE]: { schema: ProblemSchema } },
      };
    }

    registry.registerPath({
      method: e.method,
      path: e.path,
      operationId: e.operationId,
      tags: [e.tag],
      summary: e.summary,
      security: e.auth ? [{ bearerAuth: [] }] : [],
      request: {
        ...(e.params ? { params: e.params } : {}),
        ...(e.query ? { query: e.query } : {}),
        ...(e.body
          ? { body: { content: { [e.bodyContentType ?? 'application/json']: { schema: e.body } } } }
          : {}),
      },
      responses: responses as never,
    });
  }

  const generator = new OpenApiGeneratorV31([
    ...registry.definitions,
    ...standaloneSchemas.map((schema) => ({ type: 'schema' as const, schema })),
  ]);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Personal AI OS API',
      version: API_VERSION,
      description:
        'Dihasilkan dari packages/contracts. Jangan diedit tangan; jalankan pnpm --filter @aios/contracts build.',
    },
    servers: [{ url: '/v1' }],
  });
}

export function serializeOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
