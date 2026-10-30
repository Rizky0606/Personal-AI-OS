// Agent ACP palsu untuk tes gateway (bukan dsh). Perilaku ditentukan oleh teks prompt:
//   "izin"  : tool execute + session/request_permission; hasilnya mengikuti pilihan klien
//   "macet" : mengirim satu potongan lalu menunggu session/cancel
//   "mati"  : keluar mendadak di tengah giliran
//   "env"   : menjawab dengan JSON lingkungan dan cwd proses
//   lainnya : menjawab "halo dari dsh"
import { createInterface } from 'node:readline';

const send = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
const update = (u) => send({ method: 'session/update', params: { sessionId: 's1', update: u } });
const text = (t) =>
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });

let promptId;
let permissionId;
let cancelled = false;
const rl = createInterface({ input: process.stdin });
rl.on('close', () => process.exit(0));

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { close: {} } },
        agentInfo: { name: 'fake-dsh' },
        authMethods: [],
      },
    });
  } else if (msg.method === 'session/new') {
    send({ id: msg.id, result: { sessionId: 's1' } });
  } else if (msg.method === 'session/set_config_option') {
    send({ id: msg.id, result: { configOptions: [] } });
  } else if (msg.method === 'session/close') {
    send({ id: msg.id, result: {} });
  } else if (msg.method === 'session/cancel') {
    cancelled = true;
    if (promptId !== undefined) send({ id: promptId, result: { stopReason: 'cancelled' } });
  } else if (msg.method === 'session/prompt') {
    promptId = msg.id;
    // Adapter menggabungkan pesan sistem, riwayat, lalu pesan pengguna dengan pemisah; hanya yang terakhir dicocokkan.
    const prompt = msg.params.prompt
      .map((b) => b.text ?? '')
      .join('\n')
      .split('\n\n---\n\n')
      .pop()
      .trim();
    if (prompt.includes('mati')) {
      text('sebagian');
      process.exit(1);
    } else if (prompt.includes('macet')) {
      text('mulai');
    } else if (prompt.includes('env')) {
      text(
        JSON.stringify({
          cwd: process.cwd(),
          hasDatabaseUrl: process.env.DATABASE_URL !== undefined,
          hasAuthSecret: process.env.AUTH_SECRET !== undefined,
          llmKey: process.env.DSH_LLM_API_KEY ?? null,
          nodeOptions: process.env.NODE_OPTIONS ?? null,
        }),
      );
      send({ id: promptId, result: { stopReason: 'end_turn' } });
    } else if (prompt.includes('izin')) {
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Run command',
        kind: 'execute',
        status: 'pending',
        rawInput: { command: 'rm -rf build' },
      });
      permissionId = 900;
      send({
        id: permissionId,
        method: 'session/request_permission',
        params: {
          sessionId: 's1',
          toolCall: {
            toolCallId: 't1',
            title: 'Run command',
            kind: 'execute',
            rawInput: { command: 'rm -rf build' },
          },
          options: [
            { optionId: 'ya', name: 'Allow', kind: 'allow_once' },
            { optionId: 'tidak', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
    } else {
      text('halo dari dsh');
      send({ id: promptId, result: { stopReason: 'end_turn' } });
    }
  } else if (msg.id === permissionId && msg.result) {
    const picked = msg.result.outcome?.optionId;
    update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: picked === 'ya' ? 'completed' : 'failed',
    });
    text(picked === 'ya' ? 'diizinkan' : 'ditolak');
    if (!cancelled) send({ id: promptId, result: { stopReason: 'end_turn' } });
  }
});
