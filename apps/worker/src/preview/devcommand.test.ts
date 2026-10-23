import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectDevCommand } from './devcommand.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'aios-dev-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const pkg = (scripts: Record<string, string>, extra: object = {}) =>
  fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts, ...extra }));

/** Perintah yang dijalankan tanpa memedulikan pembungkus cmd.exe di Windows. */
const tokens = (c: { command: string; args: string[] }) =>
  [c.command, ...c.args].filter((t) => !['cmd.exe', '/d', '/c'].includes(t));

describe('detectDevCommand', () => {
  it('memilih skrip dev lebih dulu, lalu start, serve, preview', async () => {
    await pkg({ start: 'node a', dev: 'vite', preview: 'vite preview' });
    expect((await detectDevCommand(dir))?.script).toBe('dev');

    await pkg({ preview: 'vite preview', serve: 'x' });
    expect((await detectDevCommand(dir))?.script).toBe('serve');
  });

  it('manajer paket dari kolom packageManager atau berkas lock; bawaan npm', async () => {
    await pkg({ dev: 'x' });
    expect((await detectDevCommand(dir))?.manager).toBe('npm');

    await fs.writeFile(path.join(dir, 'pnpm-lock.yaml'), '');
    const pnpm = await detectDevCommand(dir);
    expect(pnpm?.manager).toBe('pnpm');
    expect(pnpm?.label).toBe('pnpm run dev');
    expect(tokens(pnpm!)).toEqual(['pnpm', 'run', 'dev']);

    await pkg({ dev: 'x' }, { packageManager: 'yarn@4.1.0' });
    expect((await detectDevCommand(dir))?.manager).toBe('yarn');
  });

  it('tanpa skrip yang cocok, tanpa package.json, atau berkas rusak: undefined', async () => {
    expect(await detectDevCommand(dir)).toBeUndefined();
    await pkg({ build: 'tsc', test: 'vitest' });
    expect(await detectDevCommand(dir)).toBeUndefined();
    await fs.writeFile(path.join(dir, 'package.json'), '{rusak');
    expect(await detectDevCommand(dir)).toBeUndefined();
    await fs.writeFile(path.join(dir, 'package.json'), '[1]');
    expect(await detectDevCommand(dir)).toBeUndefined();
  });
});
