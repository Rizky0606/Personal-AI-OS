import {
  CreateMcpConnectorRequestSchema,
  McpConnectorListSchema,
  McpConnectorProbeSchema,
  McpConnectorSchema,
  ProbeMcpConnectorRequestSchema,
  SetMcpConnectorEnabledRequestSchema,
  UpdateMcpConnectorRequestSchema,
} from '@aios/contracts';
import type { FastifyPluginCallback } from 'fastify';
import { requireScope } from '../auth/guard.js';
import type { McpConnectorService } from './service.js';

export interface McpConnectorRouteOptions {
  connectors: McpConnectorService;
}

/**
 * REST pemilik untuk konektor MCP pihak ketiga (docs/DESIGN_MCP_KONEKTOR.md bagian 10). Alur pendaftarannya
 * meniru pasang skill: `probe` dulu (pratinjau tool), pemilik memilih, baru disimpan — dan konektor baru
 * selalu mati sampai dinyalakan. Token hanya bisa ditulis; respons tidak pernah memuatnya.
 */
export const mcpConnectorRoutes: FastifyPluginCallback<McpConnectorRouteOptions> = (
  app,
  opts,
  done,
) => {
  const { connectors } = opts;
  const ownerOnly = { onRequest: requireScope('app') };

  app.get('/mcp-connectors', ownerOnly, async () =>
    McpConnectorListSchema.parse({ items: await connectors.list() }),
  );

  app.post('/mcp-connectors', ownerOnly, async (req, reply) => {
    const body = CreateMcpConnectorRequestSchema.parse(req.body);
    const saved = await connectors.create(
      {
        name: body.name,
        displayName: body.displayName,
        url: body.url,
        ...(body.token === undefined ? {} : { token: body.token }),
        tools: body.tools,
      },
      req.auth?.deviceId ?? null,
    );
    return reply.code(201).send(McpConnectorSchema.parse(saved));
  });

  app.post('/mcp-connectors/probe', ownerOnly, async (req) => {
    const body = ProbeMcpConnectorRequestSchema.parse(req.body);
    return McpConnectorProbeSchema.parse(await connectors.probe(body.url, body.token));
  });

  app.get<{ Params: { id: string } }>('/mcp-connectors/:id', ownerOnly, async (req) =>
    McpConnectorSchema.parse(await connectors.get(req.params.id)),
  );

  app.patch<{ Params: { id: string } }>('/mcp-connectors/:id', ownerOnly, async (req) => {
    const body = UpdateMcpConnectorRequestSchema.parse(req.body);
    const saved = await connectors.update(req.params.id, body, req.auth?.deviceId ?? null);
    return McpConnectorSchema.parse(saved);
  });

  app.delete<{ Params: { id: string } }>('/mcp-connectors/:id', ownerOnly, async (req, reply) => {
    await connectors.remove(req.params.id, req.auth?.deviceId ?? null);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/mcp-connectors/:id/enable', ownerOnly, async (req) => {
    const body = SetMcpConnectorEnabledRequestSchema.parse(req.body);
    const saved = await connectors.setEnabled(
      req.params.id,
      body.enabled,
      req.auth?.deviceId ?? null,
    );
    return McpConnectorSchema.parse(saved);
  });

  app.post<{ Params: { id: string } }>('/mcp-connectors/:id/probe', ownerOnly, async (req) =>
    McpConnectorProbeSchema.parse(
      await connectors.reprobe(req.params.id, req.auth?.deviceId ?? null),
    ),
  );

  done();
};
