import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermesSkillFile, syncHermesSkills, type HermesSyncSkill } from './hermes-sync.js';

const skill = (id: string, body = `Isi ${id}.`): HermesSyncSkill => ({
  id,
  description: `Saat memakai ${id}: "kutip" aman.`,
  version: '1',
  body,
});

/** Sidik jari seluruh pohon file (jalur + isi) untuk membuktikan folder lain tidak berubah. */
async function fingerprint(dir: string): Promise<string> {
  const lines: string[] = [];
  const walk = async (current: string) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        lines.push(
          `${full}:${createHash('sha256')
            .update(await readFile(full))
            .digest('hex')}`,
        );
    }
  };
  await walk(dir);
  return lines.join('\n');
}

let root: string;
let outside: string;
beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'aios-hermes-sync-'));
  root = join(base, 'skills');
  outside = join(base, 'luar');
  await mkdir(join(root, 'productivity', 'notion'), { recursive: true });
  await writeFile(
    join(root, 'productivity', 'notion', 'SKILL.md'),
    '---\nname: notion\n---\nmilik Hermes\n',
  );
  await writeFile(join(root, 'agent-reach.md'), 'milik pengguna');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'rahasia.txt'), 'jangan disentuh');
});
afterEach(async () => {
  await rm(join(root, '..'), { recursive: true, force: true });
});

describe('sinkron katalog ke folder skill Hermes', () => {
  it('menulis aios/<id>/SKILL.md bernama aios-<id>; folder lain tidak berubah sama sekali', async () => {
    const before = await fingerprint(join(root, 'productivity'));
    const beforeFile = await readFile(join(root, 'agent-reach.md'), 'utf8');

    const result = await syncHermesSkills([skill('ui-baseline'), skill('citation')], { root });

    expect(result.written.sort()).toEqual(['citation', 'ui-baseline']);
    const text = await readFile(join(root, 'aios', 'ui-baseline', 'SKILL.md'), 'utf8');
    expect(text).toBe(hermesSkillFile(skill('ui-baseline')));
    expect(text).toContain('name: aios-ui-baseline');
    expect(await fingerprint(join(root, 'productivity'))).toBe(before);
    expect(await readFile(join(root, 'agent-reach.md'), 'utf8')).toBe(beforeFile);
    expect((await readdir(root)).sort()).toEqual(['agent-reach.md', 'aios', 'productivity']);
  });

  it('idempoten: sinkron kedua tidak menulis apa pun', async () => {
    await syncHermesSkills([skill('a-satu')], { root });
    const second = await syncHermesSkills([skill('a-satu')], { root });
    expect(second).toMatchObject({ written: [], unchanged: ['a-satu'], removed: [] });
  });

  it('isi berubah ditulis ulang; skill yang hilang dari katalog dihapus hanya bila buatan kita', async () => {
    await syncHermesSkills([skill('lama'), skill('tetap')], { root });
    await mkdir(join(root, 'aios', 'buatan-pengguna'), { recursive: true });
    await writeFile(
      join(root, 'aios', 'buatan-pengguna', 'SKILL.md'),
      '---\nname: punya-saya\n---\nx\n',
    );

    const result = await syncHermesSkills([skill('tetap', 'isi baru')], { root });

    expect(result.written).toEqual(['tetap']);
    expect(result.removed).toEqual(['lama']);
    expect(result.skipped).toEqual(['buatan-pengguna']);
    expect(await readdir(join(root, 'aios'))).toEqual(
      expect.arrayContaining(['tetap', 'buatan-pengguna']),
    );
    expect(await readdir(join(root, 'aios'))).not.toContain('lama');
  });

  it('berkas aios/<id> yang bukan buatan kita tidak ditimpa', async () => {
    await mkdir(join(root, 'aios', 'ui-baseline'), { recursive: true });
    await writeFile(join(root, 'aios', 'ui-baseline', 'SKILL.md'), '---\nname: milik-orang\n---\n');
    const result = await syncHermesSkills([skill('ui-baseline')], { root });
    expect(result.skipped).toEqual(['ui-baseline']);
    expect(await readFile(join(root, 'aios', 'ui-baseline', 'SKILL.md'), 'utf8')).toContain(
      'milik-orang',
    );
  });

  it('dry-run melaporkan rencana tanpa menyentuh disk', async () => {
    const before = await fingerprint(root);
    const result = await syncHermesSkills([skill('baru')], { root, dryRun: true });
    expect(result.written).toEqual(['baru']);
    expect(await fingerprint(root)).toBe(before);
    expect(await readdir(root)).not.toContain('aios');
  });

  it('menolak id yang mencoba keluar dari aios/ dan symlink yang mengarah ke luar', async () => {
    await expect(syncHermesSkills([skill('../luar')], { root })).rejects.toThrow(/tidak valid/);
    await mkdir(join(root, 'aios'), { recursive: true });
    await symlink(outside, join(root, 'aios', 'ui-baseline'));
    await expect(syncHermesSkills([skill('ui-baseline')], { root })).rejects.toThrow(/symlink/);
    expect(await readFile(join(outside, 'rahasia.txt'), 'utf8')).toBe('jangan disentuh');
    expect(await readdir(outside)).toEqual(['rahasia.txt']);
  });

  it('folder skill Hermes yang tidak ada ditolak, bukan dibuat diam-diam', async () => {
    await expect(
      syncHermesSkills([skill('a-satu')], { root: join(root, 'tidak-ada') }),
    ).rejects.toThrow(/tidak ada/);
  });
});
