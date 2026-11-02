import { AcpConnection, AcpRpcError, isRecord, type AcpTransport } from './rpc.js';
import type { AcpLaunch } from './adapter.js';

export type AcpProbeResult = { ok: true; agent?: string } | { ok: false; reason: string };

export interface AcpProbeOptions {
  /** Peluncur yang sama dengan yang dipakai run sungguhan, supaya batas pengguna dan lingkungan ikut diuji. */
  launch: (spec: AcpLaunch) => AcpTransport | Promise<AcpTransport>;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Batas menunggu jawaban `initialize`; default 8 detik. */
  timeoutMs?: number;
}

const PROBE_RUN_ID = 'probe';

/**
 * Pemeriksaan kesehatan agent ACP: proses diluncurkan, dijabat tangan lewat `initialize`, lalu dimatikan.
 * Tidak membuat sesi dan tidak mengirim prompt, jadi tidak memakai model. Tidak pernah melempar.
 */
export async function probeAcp(options: AcpProbeOptions): Promise<AcpProbeResult> {
  let transport: AcpTransport | undefined;
  let connection: AcpConnection | undefined;
  try {
    transport = await options.launch({
      runId: PROBE_RUN_ID,
      args: options.args,
      cwd: options.cwd,
      env: options.env ?? {},
    });
    connection = new AcpConnection(transport, {
      onNotification: () => undefined,
      onRequest: () => Promise.reject(new AcpRpcError(-32601, 'Method not found')),
      onClose: () => undefined,
    });
    const init = await connection.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'personal-ai-os', version: '0.0.0' },
      },
      options.timeoutMs ?? 8000,
    );
    const info = isRecord(init) && isRecord(init.agentInfo) ? init.agentInfo : {};
    return typeof info.name === 'string' ? { ok: true, agent: info.name } : { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Proses agent gagal.' };
  } finally {
    connection?.dispose();
    try {
      transport?.closeInput();
    } finally {
      transport?.kill();
    }
  }
}
