import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { stdioTransport } from '../omp-stdio.js';
import { probeAcp } from './probe.js';

const ANSWER = `
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'agen-uji' } } }) + '\\n');
});
`;
const SILENT = 'setInterval(() => undefined, 1000);';
const DIES = 'process.exit(3);';

const probeWith = (script: string, timeoutMs = 4000) =>
  probeAcp({
    launch: (spec) => {
      const child = spawn(process.execPath, ['-e', script, ...spec.args], {
        cwd: spec.cwd,
        stdio: 'pipe',
        windowsHide: true,
      });
      return stdioTransport(child, () => child.kill());
    },
    args: [],
    cwd: tmpdir(),
    timeoutMs,
  });

describe('probeAcp', () => {
  it('lulus bila agent menjawab initialize, dan melaporkan namanya', async () => {
    expect(await probeWith(ANSWER)).toEqual({ ok: true, agent: 'agen-uji' });
  });

  it('gagal dengan alasan bila proses mati sebelum menjawab', async () => {
    const result = await probeWith(DIES);
    expect(result.ok).toBe(false);
  });

  it('gagal dengan alasan bila agent diam melewati batas waktu, tanpa menggantung', async () => {
    const result = await probeWith(SILENT, 300);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/initialize/);
  });

  it('gagal bila peluncur melempar galat (perintah tidak ditemukan)', async () => {
    const result = await probeAcp({
      launch: () => {
        throw new Error('spawn dsh ENOENT');
      },
      args: [],
      cwd: tmpdir(),
    });
    expect(result).toEqual({ ok: false, reason: 'spawn dsh ENOENT' });
  });
});
