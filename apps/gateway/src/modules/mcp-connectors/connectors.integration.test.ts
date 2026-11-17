import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  GatewayToWorkerFrameSchema,
  LoginResponseSchema,
  McpConnectorListSchema,
  McpConnectorProbeSchema,
  McpConnectorSchema,
  RunSchema,
  SendMessageResponseSchema,
  type GatewayToWorkerFrame,
} from '@aios/contracts';
import { desc } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { WebSocket } from 'ws';
import { auditLog } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

/*
 * Konektor MCP pihak ketiga dari ujung ke ujung (docs/DESIGN_MCP_KONEKTOR.md): pendaftaran lewat REST pemilik,
 * lalu panggilan tool lewat `/v1/mcp/connector/:id` dengan run coding sungguhan dan worker tiruan. Server MCP
 * pihak ketiga adalah server HTTP sungguhan di loopback.
 */

const TOKEN = 'token-konektor-rahasia-1234';
const stack = { languages: ['typescript'], frameworks: [] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, label: string, ms = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > ms) throw new Error(`timeout menunggu ${label}`);
    await sleep(15);
  }
}

/** Server MCP pihak ketiga sekali pakai: initialize, tools/list, tools/call, token wajib. */
function startThirdParty(): Promise<{ url: string; server: Server; seen: string[] }> {
  const seen: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        id?: number;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      seen.push(body.method ?? '');
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      if (body.method === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }
      const result =
        body.method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'kebun-binatang', version: '1.0' },
            }
          : body.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'cari_hewan',
                    description: 'Mencari hewan',
                    inputSchema: { type: 'object', properties: { nama: { type: 'string' } } },
                    annotations: { readOnlyHint: true },
                  },
                  {
                    name: 'beri_makan',
                    description: 'Memberi makan hewan',
                    inputSchema: { type: 'object', properties: { nama: { type: 'string' } } },
                  },
                ],
              }
            : {
                content: [
                  { type: 'text', text: `dipanggil ${body.params?.name ?? ''}: harimau, gajah` },
                ],
              };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, server, seen });
    });
  });
}

class FakeWorker {
  readonly commands: GatewayToWorkerFrame[] = [];
  private socket!: WebSocket;
  constructor(private readonly token: string) {}
  async connect(url: string): Promise<void> {
    this.socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` } });
    this.socket.on('message', (data: Buffer) => {
      this.commands.push(GatewayToWorkerFrameSchema.parse(JSON.parse(data.toString('utf8'))));
    });
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }
  start() {
    return this.commands.find(
      (c): c is Extract<GatewayToWorkerFrame, { type: 'run.start' }> => c.type === 'run.start',
    );
  }
  close() {
    this.socket?.terminate();
  }
}

let env: AuthEnv;
let desktop: string;
let wsUrl: string;
let third: Awaited<ReturnType<typeof startThirdParty>>;
const workers: FakeWorker[] = [];

/** Worker + project + run coding yang sudah `running`. */
async function runningRun(name: string, extra: object = {}) {
  const worker = LoginResponseSchema.parse(
    (await env.post('/devices/worker', { name }, desktop)).json(),
  );
  const project = (
    await env.post(
      '/projects',
      { name: `Project ${name}`, workerDeviceId: worker.device.id, stack },
      desktop,
    )
  ).json<{ id: string }>();
  const conversation = (
    await env.post('/conversations', { surface: 'windows', projectId: project.id }, desktop)
  ).json<{ id: string }>();
  const fake = new FakeWorker(worker.accessToken);
  workers.push(fake);
  await fake.connect(wsUrl);
  const res = await env.post(
    `/conversations/${conversation.id}/messages`,
    { parts: [{ type: 'text', text: 'tolong lihat kebun binatang' }], ...extra },
    desktop,
  );
  expect(res.statusCode, res.body).toBe(201);
  const run = SendMessageResponseSchema.parse(res.json()).run;
  await until(() => fake.start() !== undefined, 'run.start');
  await until(
    async () =>
      RunSchema.parse((await env.get(`/runs/${run.id}`, desktop)).json()).status === 'running',
    'running',
  );
  return { token: worker.accessToken, runId: run.id, fake };
}

const rpc = (
  connectorId: string,
  body: unknown,
  headers: Record<string, string | undefined> = {},
) =>
  env.app.inject({
    method: 'POST',
    url: `/v1/mcp/connector/${connectorId}`,
    headers: {
      'content-type': 'application/json',
      ...Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)),
    } as Record<string, string>,
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });

const as = (token: string | undefined, runId?: string) => ({
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...(runId ? { 'x-aios-run-id': runId } : {}),
});

const callTool = (name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
});

const textOf = (body: unknown): string => {
  const result = (body as { result?: { content?: { text?: string }[] } }).result;
  return result?.content?.[0]?.text ?? '';
};

/** Konektor baru lewat REST pemilik, dengan allowlist dari hasil probe. */
async function createConnector(name: string, token: string | undefined = TOKEN) {
  const probe = McpConnectorProbeSchema.parse(
    (
      await env.post(
        '/mcp-connectors/probe',
        { url: third.url, ...(token ? { token } : {}) },
        desktop,
      )
    ).json(),
  );
  const created = await env.post(
    '/mcp-connectors',
    {
      name,
      displayName: 'Kebun Binatang',
      url: third.url,
      ...(token ? { token } : {}),
      tools: probe.tools,
    },
    desktop,
  );
  expect(created.statusCode, created.body).toBe(201);
  return { probe, connector: McpConnectorSchema.parse(created.json()) };
}

beforeAll(async () => {
  third = await startThirdParty();
  env = await createAuthEnv(inject('testDatabaseUrl'), {
    mcpConnectors: { allowPrivateHosts: true },
    workerRelay: { disconnectGraceMs: 300, cancelGraceMs: 300 },
  });
  desktop = (await env.loginOk({ kind: 'desktop' })).accessToken;
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  wsUrl = `ws://127.0.0.1:${(env.app.server.address() as AddressInfo).port}/v1/worker/ws`;
});

afterAll(async () => {
  for (const worker of workers) worker.close();
  await env.close();
  await new Promise<void>((resolve) => third.server.close(() => resolve()));
});

describe('REST konektor (pemilik)', () => {
  it('probe menyajikan daftar tool dengan tanda baca/tulis', async () => {
    const res = await env.post('/mcp-connectors/probe', { url: third.url, token: TOKEN }, desktop);
    expect(res.statusCode, res.body).toBe(200);
    const probe = McpConnectorProbeSchema.parse(res.json());
    expect(probe.serverName).toBe('kebun-binatang');
    expect(probe.tools.map((t) => [t.name, t.readOnly])).toEqual([
      ['cari_hewan', true],
      // Tanpa readOnlyHint = dianggap menulis.
      ['beri_makan', false],
    ]);
  });

  it('probe dengan token salah menjawab 502 tanpa menyimpan apa pun', async () => {
    const res = await env.post(
      '/mcp-connectors/probe',
      { url: third.url, token: 'salah' },
      desktop,
    );
    expect(res.statusCode).toBe(502);
    expect(res.json<{ code: string }>().code).toBe('connector_unreachable');
  });

  it('URL yang tidak https ditolak 422 di produksi (allowPrivateHosts mati)', async () => {
    const ketat = await createAuthEnv(inject('testDatabaseUrl'), {});
    const app = (await ketat.loginOk({ kind: 'desktop' })).accessToken;
    const res = await ketat.post(
      '/mcp-connectors/probe',
      { url: 'http://169.254.169.254/latest/meta-data' },
      app,
    );
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('connector_url_invalid');
    await ketat.close();
  });

  it('konektor baru tersimpan mati dan tokennya tidak pernah dikembalikan', async () => {
    const { connector } = await createConnector('zoo');
    expect(connector.enabled).toBe(false);
    expect(connector.hasToken).toBe(true);
    expect(JSON.stringify(connector)).not.toContain(TOKEN);

    const list = McpConnectorListSchema.parse((await env.get('/mcp-connectors', desktop)).json());
    expect(JSON.stringify(list)).not.toContain(TOKEN);
    expect(list.items.some((c) => c.name === 'zoo')).toBe(true);

    const one = (await env.get(`/mcp-connectors/${connector.id}`, desktop)).json<unknown>();
    expect(JSON.stringify(one)).not.toContain(TOKEN);
  });

  it('nama slug yang sama ditolak 409', async () => {
    await createConnector('kembar');
    const res = await env.post(
      '/mcp-connectors',
      { name: 'kembar', displayName: 'Lain', url: third.url, tools: [] },
      desktop,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('connector_name_taken');
  });

  it('PATCH tanpa field token tidak menghapus token tersimpan', async () => {
    const { connector } = await createConnector('tetap');
    const res = await env.app.inject({
      method: 'PATCH',
      url: `/v1/mcp-connectors/${connector.id}`,
      headers: { authorization: `Bearer ${desktop}` },
      payload: { displayName: 'Nama Baru' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const saved = McpConnectorSchema.parse(res.json());
    expect(saved.displayName).toBe('Nama Baru');
    expect(saved.hasToken).toBe(true);
    // Tokennya masih dipakai: probe ulang lewat token tersimpan berhasil.
    const again = await env.post(`/mcp-connectors/${connector.id}/probe`, {}, desktop);
    expect(again.statusCode, again.body).toBe(200);
  });

  it('token: null menghapus token, dan konektor tanpa token ditolak server pihak ketiga', async () => {
    const { connector } = await createConnector('lepas');
    const res = await env.app.inject({
      method: 'PATCH',
      url: `/v1/mcp-connectors/${connector.id}`,
      headers: { authorization: `Bearer ${desktop}` },
      payload: { token: null },
    });
    expect(McpConnectorSchema.parse(res.json()).hasToken).toBe(false);
    const probe = await env.post(`/mcp-connectors/${connector.id}/probe`, {}, desktop);
    expect(probe.statusCode).toBe(502);
    // Kegagalan tersimpan di lastError tanpa token.
    const after = McpConnectorSchema.parse(
      (await env.get(`/mcp-connectors/${connector.id}`, desktop)).json(),
    );
    expect(after.lastError).toBeTruthy();
    expect(after.lastError ?? '').not.toContain(TOKEN);
  });

  it('konektor tanpa tool tidak bisa dinyalakan', async () => {
    const created = await env.post(
      '/mcp-connectors',
      { name: 'kosong', displayName: 'Kosong', url: third.url, tools: [] },
      desktop,
    );
    const connector = McpConnectorSchema.parse(created.json());
    const res = await env.post(
      `/mcp-connectors/${connector.id}/enable`,
      { enabled: true },
      desktop,
    );
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('connector_no_tools');
  });

  it('hapus konektor', async () => {
    const { connector } = await createConnector('buang');
    const res = await env.app.inject({
      method: 'DELETE',
      url: `/v1/mcp-connectors/${connector.id}`,
      headers: { authorization: `Bearer ${desktop}` },
    });
    expect(res.statusCode).toBe(204);
    expect((await env.get(`/mcp-connectors/${connector.id}`, desktop)).statusCode).toBe(404);
  });
});

describe('server MCP per konektor (worker)', () => {
  it('matriks auth: token app ditolak, worker tanpa run ditolak, run milik worker lain ditolak', async () => {
    const { connector } = await createConnector('auth');
    await env.post(`/mcp-connectors/${connector.id}/enable`, { enabled: true }, desktop);
    const a = await runningRun('worker-auth-a');
    const b = await runningRun('worker-auth-b');

    expect((await rpc(connector.id, callTool('cari_hewan'), as(undefined))).statusCode).toBe(401);
    expect((await rpc(connector.id, callTool('cari_hewan'), as(desktop, a.runId))).statusCode).toBe(
      403,
    );
    expect((await rpc(connector.id, callTool('cari_hewan'), as(a.token))).statusCode).toBe(400);
    // Run milik worker lain.
    expect((await rpc(connector.id, callTool('cari_hewan'), as(a.token, b.runId))).statusCode).toBe(
      403,
    );
  });

  it('konektor mati tidak terlihat dari worker (404)', async () => {
    const { connector } = await createConnector('mati');
    const run = await runningRun('worker-mati');
    const off = await rpc(
      connector.id,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      as(run.token, run.runId),
    );
    expect(off.statusCode).toBe(404);
    expect(off.json<{ code: string }>().code).toBe('connector_not_found');

    await env.post(`/mcp-connectors/${connector.id}/enable`, { enabled: true }, desktop);
    const on = await rpc(
      connector.id,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      as(run.token, run.runId),
    );
    expect(on.statusCode).toBe(200);
  });

  it('tool baca berjalan dan hasilnya berpagar; audit tanpa argumen dan tanpa token', async () => {
    const { connector } = await createConnector('jalan');
    await env.post(`/mcp-connectors/${connector.id}/enable`, { enabled: true }, desktop);
    const run = await runningRun('worker-jalan');

    const res = await rpc(
      connector.id,
      callTool('cari_hewan', { nama: 'harimau-rahasia' }),
      as(run.token, run.runId),
    );
    expect(res.statusCode, res.body).toBe(200);
    const text = textOf(res.json());
    expect(text).toContain('Data dari konektor Kebun Binatang');
    expect(text).toContain('<<<');
    expect(text).toContain('dipanggil cari_hewan');

    const rows = await env.database.handle.db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.ts))
      .limit(5);
    const entry = rows.find((r) => r.action === 'mcp.connector_called');
    expect(entry?.target).toBe(`connector:${connector.id} run:${run.runId} tool:cari_hewan ok`);
    expect(entry?.target).not.toContain('harimau-rahasia');
    expect(entry?.target).not.toContain(TOKEN);
  });

  it('tool di luar allowlist pemilik ditolak sebelum keluar', async () => {
    const probe = McpConnectorProbeSchema.parse(
      (await env.post('/mcp-connectors/probe', { url: third.url, token: TOKEN }, desktop)).json(),
    );
    const created = await env.post(
      '/mcp-connectors',
      {
        name: 'sempit',
        displayName: 'Hanya baca',
        url: third.url,
        token: TOKEN,
        tools: probe.tools.filter((t) => t.readOnly),
      },
      desktop,
    );
    const connector = McpConnectorSchema.parse(created.json());
    await env.post(`/mcp-connectors/${connector.id}/enable`, { enabled: true }, desktop);
    const run = await runningRun('worker-sempit');

    const list = await rpc(
      connector.id,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      as(run.token, run.runId),
    );
    const tools = list.json<{ result: { tools: { name: string }[] } }>().result.tools;
    expect(tools.map((t) => t.name)).toEqual(['cari_hewan']);

    const res = await rpc(connector.id, callTool('beri_makan'), as(run.token, run.runId));
    expect(res.json<{ error: { code: number } }>().error.code).toBe(-32602);
  });

  it('mode rencana menolak tool tulis', async () => {
    const { connector } = await createConnector('rencana');
    await env.post(`/mcp-connectors/${connector.id}/enable`, { enabled: true }, desktop);
    const run = await runningRun('worker-rencana', { planOnly: true });

    const tulis = await rpc(connector.id, callTool('beri_makan'), as(run.token, run.runId));
    expect(textOf(tulis.json())).toContain('Mode rencana');
    const baca = await rpc(connector.id, callTool('cari_hewan'), as(run.token, run.runId));
    expect(textOf(baca.json())).toContain('Data dari konektor');
  });

  it('run.start membawa konektor yang menyala tanpa url dan tanpa token', async () => {
    const { connector } = await createConnector('bawa');
    await env.post(`/mcp-connectors/${connector.id}/enable`, { enabled: true }, desktop);
    const run = await runningRun('worker-bawa');
    const start = run.fake.start();
    const sent = start?.connectors?.find((c) => c.id === connector.id);
    expect(sent).toEqual({ id: connector.id, name: 'bawa', displayName: 'Kebun Binatang' });
    expect(JSON.stringify(start)).not.toContain(TOKEN);
    expect(JSON.stringify(start)).not.toContain(third.url);
  });
});
