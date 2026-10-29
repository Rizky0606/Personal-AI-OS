import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SetupCommandSchema } from '@aios/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectSetupStore, setupSpawn } from './setup.js';

const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'aios-setup-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('SetupCommandSchema', () => {
  it.each(['pnpm install --offline', 'node scripts/prepare.js', '  npm ci  '])(
    'menerima %s',
    (line) => {
      expect(SetupCommandSchema.safeParse(line).success).toBe(true);
    },
  );

  it.each([
    'pnpm i && rm -rf /',
    'a | b',
    'echo $HOME',
    'x > y',
    'a; b',
    'node -e "1"',
    'a\nb',
    '%PATH%',
    '',
  ])('menolak %j (karakter shell atau kosong)', (line) => {
    expect(SetupCommandSchema.safeParse(line).success).toBe(false);
  });
});

describe('setupSpawn', () => {
  it('Windows: lewat cmd.exe supaya pnpm.cmd bisa dijalankan, tanpa menyatukan argumen menjadi satu string', () => {
    expect(setupSpawn('pnpm install  --offline', true)).toEqual([
      'cmd.exe',
      ['/d', '/c', 'pnpm', 'install', '--offline'],
    ]);
  });

  it('POSIX: program dan argumen langsung', () => {
    expect(setupSpawn('pnpm install --offline', false)).toEqual(['pnpm', ['install', '--offline']]);
  });
});

describe('ProjectSetupStore', () => {
  it('menyimpan per project, bertahan setelah dimuat ulang, dan setelan kosong menghapus entri', async () => {
    const file = path.join(dir, 'setup.json');
    const store = new ProjectSetupStore(file);
    expect(store.get(PROJECT)).toEqual({ commands: [], linkNodeModules: false, lsp: true });

    await store.set(PROJECT, { commands: ['pnpm install'], linkNodeModules: true, lsp: false });
    const reloaded = new ProjectSetupStore(file);
    await reloaded.load();
    expect(reloaded.get(PROJECT)).toEqual({
      commands: ['pnpm install'],
      linkNodeModules: true,
      lsp: false,
    });

    await reloaded.set(PROJECT, { commands: [], linkNodeModules: false, lsp: true });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ version: 1, projects: {} });
  });

  it('berkas rusak diperlakukan sebagai kosong', async () => {
    const file = path.join(dir, 'setup.json');
    await fs.writeFile(file, '{bukan json');
    const store = new ProjectSetupStore(file);
    await store.load();
    expect(store.get(PROJECT).commands).toEqual([]);
  });
});
