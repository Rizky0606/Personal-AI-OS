import { describe, expect, it } from 'vitest';
import { createMcpServer, type ToolCallRecord } from './server.js';
import type { ToolSet } from './tools.js';

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

function setup() {
  const calls: { name: string; args: Record<string, unknown>; runId: string }[] = [];
  const tools: ToolSet = {
    list: () => [
      {
        name: 'web_search',
        title: 'Cari di web',
        description: 'cari',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
    ],
    call: (name, args, ctx) => {
      calls.push({ name, args, runId: ctx.runId });
      if (name !== 'web_search') return Promise.resolve(null);
      return Promise.resolve({
        result: { content: [{ type: 'text', text: 'hasil' }] },
        ok: true,
        items: 2,
      });
    },
  };
  let t = 1000;
  const server = createMcpServer({ tools, version: '9.9.9', now: () => (t += 5) });
  const records: ToolCallRecord[] = [];
  const handle = (body: unknown) =>
    server.handle(typeof body === 'string' ? body : JSON.stringify(body), {
      runId: RUN,
      onToolCall: (r) => records.push(r),
    });
  return { handle, calls, records };
}

const rpc = (id: number, method: string, params?: unknown) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

describe('server MCP aios_tools (JSON-RPC)', () => {
  it('initialize memantulkan versi protokol klien; tanpa versi memakai bawaan', async () => {
    const { handle } = setup();
    const res = await handle(rpc(1, 'initialize', { protocolVersion: '2025-11-25' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'aios_tools', version: '9.9.9' },
      },
    });
    const bare = await handle(rpc(2, 'initialize'));
    expect(bare.body).toMatchObject({ result: { protocolVersion: '2025-03-26' } });
  });

  it('notifikasi dijawab 202 tanpa isi; ping dan tools/list', async () => {
    const { handle } = setup();
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({
      status: 202,
    });
    expect((await handle(rpc(3, 'ping'))).body).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
    const list = await handle(rpc(4, 'tools/list'));
    expect(list.body).toMatchObject({ result: { tools: [{ name: 'web_search' }] } });
  });

  it('tools/call meneruskan argumen dan run, mencatat ringkasan tanpa argumen', async () => {
    const { handle, calls, records } = setup();
    const res = await handle(
      rpc(5, 'tools/call', { name: 'web_search', arguments: { query: 'rahasia pribadi' } }),
    );
    expect(res.body).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: { content: [{ type: 'text', text: 'hasil' }] },
    });
    expect(calls).toEqual([{ name: 'web_search', args: { query: 'rahasia pribadi' }, runId: RUN }]);
    expect(records).toEqual([{ tool: 'web_search', ok: true, items: 2, durationMs: 5 }]);
    expect(JSON.stringify(records)).not.toContain('rahasia');
  });

  it('galat protokol: JSON rusak -32700 (400), method tak dikenal -32601, tool tak dikenal dan params salah -32602', async () => {
    const { handle, records } = setup();
    expect(await handle('{rusak')).toEqual({
      status: 400,
      body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
    });
    expect((await handle(rpc(6, 'resources/list'))).body).toMatchObject({
      id: 6,
      error: { code: -32601 },
    });
    expect(
      (await handle(rpc(7, 'tools/call', { name: 'rm_rf', arguments: {} }))).body,
    ).toMatchObject({ id: 7, error: { code: -32602, message: 'Tool tidak dikenal: rm_rf' } });
    expect((await handle(rpc(8, 'tools/call', { arguments: {} }))).body).toMatchObject({
      id: 8,
      error: { code: -32602 },
    });
    expect(
      (await handle(rpc(9, 'tools/call', { name: 'web_search', arguments: 'kueri' }))).body,
    ).toMatchObject({ id: 9, error: { code: -32602 } });
    expect((await handle({ id: 10, method: 'ping' })).body).toMatchObject({
      id: null,
      error: { code: -32600 },
    });
    expect(await handle([])).toMatchObject({ status: 400, body: { error: { code: -32600 } } });
    expect(records).toEqual([]);
  });

  it('batch dijawab sebagai array; notifikasi di dalamnya tidak dijawab', async () => {
    const { handle } = setup();
    const res = await handle([
      rpc(1, 'ping'),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc(2, 'tools/list'),
    ]);
    expect(res.status).toBe(200);
    expect((res.body as { id: number }[]).map((r) => r.id)).toEqual([1, 2]);
  });
});
