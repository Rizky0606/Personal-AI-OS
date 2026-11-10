import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSkillCache, type CatalogSkill, type SkillRemote } from './cache.js';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const skill = (id: string, body: string): CatalogSkill => ({
  id,
  description: `Saat memakai ${id}.`,
  body,
  checksum: sha(body),
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aios-skill-cache-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeRemote(initial: CatalogSkill[]) {
  const catalog = new Map(initial.map((s) => [s.id, s]));
  const calls = { list: 0, get: [] as string[] };
  const remote: SkillRemote = {
    list: () => {
      calls.list++;
      return Promise.resolve(
        [...catalog.values()].map((s) => ({ id: s.id, checksum: s.checksum })),
      );
    },
    get: (id) => {
      calls.get.push(id);
      const found = catalog.get(id);
      return found ? Promise.resolve(found) : Promise.reject(new Error('404'));
    },
  };
  return { remote, calls, catalog };
}

describe('cache katalog skill worker', () => {
  it('mengunduh sekali; run berikutnya dengan checksum sama tidak mengunduh ulang', async () => {
    const { remote, calls } = fakeRemote([skill('alpha', 'isi alpha')]);
    const cache = createSkillCache(dir, remote);

    expect((await cache.resolve(['alpha']))[0]?.body).toBe('isi alpha');
    expect((await cache.resolve(['alpha']))[0]?.body).toBe('isi alpha');

    expect(calls.get).toEqual(['alpha']);
    expect(calls.list).toBe(2);
  });

  it('mengunduh ulang hanya skill yang checksum-nya berubah', async () => {
    const { remote, calls, catalog } = fakeRemote([skill('alpha', 'a1'), skill('beta', 'b1')]);
    const cache = createSkillCache(dir, remote);
    await cache.resolve(['alpha', 'beta']);

    catalog.set('alpha', skill('alpha', 'a2'));
    const result = await cache.resolve(['alpha', 'beta']);

    expect(result.map((s) => s.body)).toEqual(['a2', 'b1']);
    expect(calls.get).toEqual(['alpha', 'beta', 'alpha']);
  });

  it('menolak isi yang tidak cocok dengan checksum yang diumumkan dan tidak menyimpannya', async () => {
    const good = skill('alpha', 'asli');
    const { remote } = fakeRemote([good]);
    const tampered: SkillRemote = {
      list: () => remote.list(),
      get: () => Promise.resolve({ ...good, body: 'dipalsukan' }),
    };
    await expect(createSkillCache(dir, tampered).resolve(['alpha'])).rejects.toThrow(/checksum/);
    await expect(readFile(join(dir, 'alpha.json'), 'utf8')).rejects.toThrow();
  });

  it('salinan lokal yang rusak diunduh ulang, bukan dipercaya', async () => {
    const { remote, calls } = fakeRemote([skill('alpha', 'isi')]);
    await writeFile(
      join(dir, 'alpha.json'),
      JSON.stringify({ ...skill('alpha', 'isi'), body: 'diubah di disk' }),
    );
    const result = await createSkillCache(dir, remote).resolve(['alpha']);
    expect(result[0]?.body).toBe('isi');
    expect(calls.get).toEqual(['alpha']);
  });

  it('gateway tak terjangkau: pakai cache yang ada; tanpa cache gagal jelas', async () => {
    const { remote } = fakeRemote([skill('alpha', 'isi')]);
    await createSkillCache(dir, remote).resolve(['alpha']);
    const offline: SkillRemote = {
      list: () => Promise.reject(new Error('offline')),
      get: () => Promise.reject(new Error('offline')),
    };
    const cache = createSkillCache(dir, offline);
    expect((await cache.resolve(['alpha']))[0]?.body).toBe('isi');
    await expect(cache.resolve(['beta'])).rejects.toThrow('offline');
  });

  it('skill yang tidak ada di katalog gagal; id berbahaya ditolak sebelum menyentuh disk', async () => {
    const { remote } = fakeRemote([skill('alpha', 'isi')]);
    const cache = createSkillCache(dir, remote);
    await expect(cache.resolve(['hantu'])).rejects.toThrow(/tidak ada di katalog/);
    await expect(cache.resolve(['../../etc/passwd'])).rejects.toThrow(/tidak valid/);
  });
});
