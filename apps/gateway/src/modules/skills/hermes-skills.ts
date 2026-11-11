import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { MAX_SKILL_MD_BYTES, parseSkillMd } from './installer.js';
import { HERMES_SKILL_FOLDER, HERMES_SKILL_PREFIX } from './hermes-sync.js';

/**
 * Skill milik Hermes (P10, hanya baca). Daftar diambil dari `GET /v1/skills` Hermes; bila gagal (Hermes 0.22.5
 * menjawab 500, lihat BACKLOG) atau tidak mengembalikan apa-apa, dibaca dari folder skill Hermes yang
 * dikonfigurasi (`HERMES_SKILLS_DIR`). Skill buatan kita (`aios-*`, folder `aios/`) tidak ikut. Tidak pernah
 * menulis ke folder Hermes dan tidak mengikuti symlink.
 */
export interface HermesSkillEntry {
  name: string;
  description: string;
}

const MAX_DEPTH = 3;
/** Folder Hermes nyata bisa memuat ratusan skill (444 di mesin pengembangan); batas ini hanya pagar pengaman. */
const MAX_ENTRIES = 2000;

async function scanFolder(
  root: string,
): Promise<Map<string, { description: string; file: string }> & { truncated?: boolean }> {
  const out: Map<string, { description: string; file: string }> & { truncated?: boolean } =
    new Map();
  const base = resolve(root);
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    if (out.size >= MAX_ENTRIES) {
      out.truncated = true;
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0 && entry.name === HERMES_SKILL_FOLDER) continue; // skill kita sendiri
        if (entry.name.startsWith('.')) continue;
        await walk(path, depth + 1);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        const info = await lstat(path);
        if (info.size > MAX_SKILL_MD_BYTES || !resolve(path).startsWith(base + sep)) continue;
        try {
          const parsed = parseSkillMd(await readFile(path, 'utf8'));
          if (!parsed.name.startsWith(HERMES_SKILL_PREFIX) && !out.has(parsed.name))
            out.set(parsed.name, { description: parsed.description, file: path });
        } catch {
          // SKILL.md yang tidak bisa diurai tidak ditampilkan.
        }
      }
    }
  };
  await walk(base, 0);
  return out;
}

export interface HermesSkillSource {
  list(): Promise<{
    items: HermesSkillEntry[];
    via: 'api' | 'folder' | 'none';
    note?: string;
    /** Nama skill yang isinya bisa dibaca dari folder (jadi bisa diimpor). */
    readable: string[];
  }>;
  /** Isi lengkap (SKILL.md terurai) satu skill Hermes; hanya dari folder. */
  read(name: string): Promise<{ name: string; description: string; body: string } | undefined>;
  /** Apakah isi skill bisa dibaca (folder dikonfigurasi). */
  readable: boolean;
}

export function createHermesSkillSource(deps: {
  url: string;
  apiKey?: string;
  root?: string;
  fetchImpl?: typeof fetch;
}): HermesSkillSource {
  const { url, apiKey, root, fetchImpl = fetch } = deps;

  const viaApi = async (): Promise<HermesSkillEntry[] | undefined> => {
    try {
      const res = await fetchImpl(`${url.replace(/\/$/, '')}/v1/skills`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return undefined;
      const json = await res.json();
      const list = Array.isArray(json)
        ? json
        : ((json as Record<string, unknown>)?.skills ??
          (json as Record<string, unknown>)?.data ??
          (json as Record<string, unknown>)?.items);
      if (!Array.isArray(list)) return undefined;
      const items: HermesSkillEntry[] = [];
      for (const raw of list as unknown[]) {
        const row = raw as Record<string, unknown>;
        const name = typeof row?.name === 'string' ? row.name : undefined;
        if (!name || name.startsWith(HERMES_SKILL_PREFIX)) continue;
        items.push({
          name,
          description: typeof row.description === 'string' ? row.description : '',
        });
      }
      return items;
    } catch {
      return undefined;
    }
  };

  return {
    readable: root !== undefined,
    async list() {
      const folder = root ? await scanFolder(root) : undefined;
      const api = await viaApi();
      const readable = folder ? [...folder.keys()] : [];
      if (api && api.length > 0) return { items: api, via: 'api', readable };
      if (folder && folder.size > 0)
        return {
          items: [...folder].map(([name, v]) => ({ name, description: v.description })),
          via: 'folder',
          readable,
          ...(folder.truncated || api === undefined
            ? {
                note: [
                  api === undefined
                    ? 'GET /v1/skills Hermes gagal; dibaca dari folder skill Hermes.'
                    : '',
                  folder.truncated
                    ? `Daftar dipotong di ${MAX_ENTRIES} skill; sisanya tidak ditampilkan.`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' '),
              }
            : {}),
        };
      return {
        items: [],
        via: 'none',
        readable,
        note: root
          ? 'Tidak ada skill Hermes yang ditemukan.'
          : 'Hermes tidak menjawab daftar skill dan HERMES_SKILLS_DIR belum diisi.',
      };
    },
    async read(name) {
      if (!root) return undefined;
      const entry = (await scanFolder(root)).get(name);
      if (!entry) return undefined;
      const parsed = parseSkillMd(await readFile(entry.file, 'utf8'));
      return { name: parsed.name, description: parsed.description, body: parsed.body };
    },
  };
}
