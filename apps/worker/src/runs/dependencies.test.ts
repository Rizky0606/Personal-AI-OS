import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dependencyInstruction } from './dependencies.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'aios-deps-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const write = (name: string, content: string) => fs.writeFile(path.join(dir, name), content);

describe('dependencyInstruction', () => {
  it('bukan project Node (tanpa package.json, atau package.json rusak): tanpa catatan', async () => {
    expect(await dependencyInstruction(dir)).toBe('');
    await write('package.json', '[1, 2]');
    expect(await dependencyInstruction(dir)).toBe('');
  });

  it('npm: `npm ci` bila ada package-lock.json, selain itu instal tanpa membuat lockfile baru', async () => {
    await write('package.json', '{"name":"a"}');
    expect(await dependencyInstruction(dir)).toContain('`npm install --no-package-lock`');
    await write('package-lock.json', '{}');
    expect(await dependencyInstruction(dir)).toContain('`npm ci`');
  });

  it('manajer dari field packageManager menang atas lockfile manajer lain', async () => {
    await write('package.json', '{"name":"a","packageManager":"yarn@1.22.0"}');
    await write('package-lock.json', '{}');
    expect(await dependencyInstruction(dir)).toContain('`yarn install --no-lockfile`');
    await write('yarn.lock', '');
    expect(await dependencyInstruction(dir)).toContain('`yarn install --frozen-lockfile`');
  });

  it('node_modules sudah ada: tanpa catatan', async () => {
    await write('package.json', '{"name":"a"}');
    await fs.mkdir(path.join(dir, 'node_modules'));
    expect(await dependencyInstruction(dir)).toBe('');
  });
});
