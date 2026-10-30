import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AcpConnection } from './acp/rpc.js';
import { stdioTransport } from './omp-stdio.js';

/**
 * Tes dengan dsh asli: hanya jabat tangan (initialize + session/new), tanpa memanggil model. Dilewati bila
 * `DSH_BIN` tidak diatur. Jalankan HANYA di sandbox (docs/RUNBOOK_DSH.md); dsh developer preview, tidak diaudit.
 */
const DSH_BIN = process.env.DSH_BIN;

describe.skipIf(!DSH_BIN)('dsh asli', () => {
  it('initialize dan session/new sesuai ACP v1', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'aios-dsh-it-'));
    const child = spawn(DSH_BIN!, ['--profile', 'acp'], { cwd, stdio: 'pipe' });
    const conn = new AcpConnection(
      stdioTransport(child, () => child.kill()),
      {
        onNotification: () => undefined,
        onRequest: () => Promise.reject(new Error('tidak diharapkan')),
        onClose: () => undefined,
      },
    );
    try {
      const init = (await conn.request(
        'initialize',
        {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'aios-test', version: '0' },
        },
        60_000,
      )) as { protocolVersion?: number };
      expect(init.protocolVersion).toBe(1);
      const created = (await conn.request('session/new', { cwd, mcpServers: [] }, 60_000)) as {
        sessionId?: string;
      };
      expect(typeof created.sessionId).toBe('string');
    } finally {
      conn.dispose();
      child.kill();
      await rm(cwd, { recursive: true, force: true });
    }
  }, 120_000);
});
