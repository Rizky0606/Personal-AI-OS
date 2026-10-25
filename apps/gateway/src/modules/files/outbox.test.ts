import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_OUTBOX_FILES, createOutbox } from './outbox.js';

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
let dir: string;
let saved: { name: string; bytes: Buffer }[];

beforeEach(async () => {
  dir = await mkdtemp(nodePath.join(tmpdir(), 'outbox-'));
  saved = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const outbox = () =>
  createOutbox({
    dir,
    hostDir: '/home/ubuntu/aios-outbox/',
    save: (input) => {
      saved.push(input);
      return Promise.resolve({ id: `f${saved.length}`, name: input.name, mime: 'application/zip' });
    },
  });

describe('folder kiriman', () => {
  it('aturan menyebut folder run di host, tanpa garis miring ganda', () => {
    const text = outbox().promptFor(RUN);
    expect(text).toContain(`/home/ubuntu/aios-outbox/${RUN}/`);
    expect(text).not.toContain('//' + RUN);
  });

  it('mengambil berkas biasa termasuk di subfolder, berurutan, menjadi bagian file', async () => {
    const run = nodePath.join(dir, RUN);
    await mkdir(nodePath.join(run, 'src'), { recursive: true });
    await writeFile(nodePath.join(run, 'proyek.zip'), 'PK-isi');
    await writeFile(nodePath.join(run, 'src', 'catatan.txt'), 'halo');
    await writeFile(nodePath.join(run, 'kosong.txt'), '');

    const parts = await outbox().collect(RUN);
    expect(parts).toEqual([
      { type: 'file', fileId: 'f1', name: 'proyek.zip', mime: 'application/zip' },
      { type: 'file', fileId: 'f2', name: 'catatan.txt', mime: 'application/zip' },
    ]);
    expect(saved.map((s) => s.bytes.toString())).toEqual(['PK-isi', 'halo']);
  });

  it('run tanpa folder, ID tidak sah, dan path keluar folder tidak mengambil apa pun', async () => {
    expect(await outbox().collect(RUN)).toEqual([]);
    expect(await outbox().collect('../etc')).toEqual([]);
  });

  it('symlink ke luar folder diabaikan', async () => {
    const run = nodePath.join(dir, RUN);
    await mkdir(run, { recursive: true });
    const secret = nodePath.join(dir, 'rahasia.txt');
    await writeFile(secret, 'jangan');
    try {
      await symlink(secret, nodePath.join(run, 'tautan.txt'));
    } catch {
      return; // Windows tanpa hak membuat symlink: kasus ini tidak bisa diuji di sini.
    }
    expect(await outbox().collect(RUN)).toEqual([]);
  });

  it(`maksimal ${MAX_OUTBOX_FILES} berkas per run`, async () => {
    const run = nodePath.join(dir, RUN);
    await mkdir(run, { recursive: true });
    for (let i = 0; i < MAX_OUTBOX_FILES + 3; i++) {
      await writeFile(nodePath.join(run, `b${String(i).padStart(2, '0')}.txt`), 'x');
    }
    expect(await outbox().collect(RUN)).toHaveLength(MAX_OUTBOX_FILES);
  });
});
