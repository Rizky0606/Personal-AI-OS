import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CatalogSkill {
  id: string;
  description: string;
  checksum: string;
  body: string;
}

/** Sumber katalog di gateway (GET /skills dan GET /skills/:id), lewat token worker. */
export interface SkillRemote {
  list(): Promise<{ id: string; checksum: string }[]>;
  get(id: string): Promise<CatalogSkill>;
}

const ID = /^[a-z][a-z0-9-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Cache katalog skill milik worker (folder data worker, bukan repo kerja dan bukan folder skill pengguna).
 * Isi hanya diunduh bila checksum di indeks gateway berbeda dari salinan lokal; isi yang diunduh wajib cocok
 * dengan checksum yang diumumkan. Bila gateway tak terjangkau, salinan lokal dipakai apa adanya.
 */
export function createSkillCache(dir: string, remote: SkillRemote) {
  const fileOf = (id: string) => join(dir, `${id}.json`);

  async function readLocal(id: string): Promise<CatalogSkill | undefined> {
    try {
      const raw = JSON.parse(await readFile(fileOf(id), 'utf8')) as Partial<CatalogSkill>;
      if (
        raw.id === id &&
        typeof raw.body === 'string' &&
        typeof raw.description === 'string' &&
        typeof raw.checksum === 'string' &&
        raw.checksum === sha256(raw.body)
      ) {
        return raw as CatalogSkill;
      }
    } catch {
      // Tidak ada atau rusak: dianggap belum ada di cache.
    }
    return undefined;
  }

  return {
    async resolve(ids: readonly string[]): Promise<CatalogSkill[]> {
      for (const id of ids) if (!ID.test(id)) throw new Error(`Id skill tidak valid: ${id}`);
      if (ids.length === 0) return [];
      let index: Map<string, string> | undefined;
      try {
        index = new Map((await remote.list()).map((s) => [s.id, s.checksum]));
      } catch {
        index = undefined; // luring: pakai cache bila lengkap
      }
      await mkdir(dir, { recursive: true });
      const out: CatalogSkill[] = [];
      for (const id of ids) {
        const local = await readLocal(id);
        const announced = index?.get(id);
        if (local && (index === undefined || local.checksum === announced)) {
          out.push(local);
          continue;
        }
        if (index !== undefined && announced === undefined) {
          throw new Error(`Skill ${id} tidak ada di katalog gateway.`);
        }
        const fresh = await remote.get(id);
        if (
          fresh.id !== id ||
          !SHA256.test(fresh.checksum) ||
          fresh.checksum !== sha256(fresh.body) ||
          (announced !== undefined && fresh.checksum !== announced)
        ) {
          throw new Error(`Skill ${id} dari gateway gagal verifikasi checksum.`);
        }
        const tmp = `${fileOf(id)}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(fresh));
        await rename(tmp, fileOf(id));
        out.push(fresh);
      }
      return out;
    },
  };
}
