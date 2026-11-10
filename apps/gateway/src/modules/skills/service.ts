import { createHash } from 'node:crypto';
import { CORE_SKILLS, type RolesRegistry } from '@aios/roles';
import type {
  SkillDetail,
  SkillEngine,
  SkillSource,
  SkillStatus,
  SkillSummary,
  SkillTrust,
} from '@aios/contracts';

/**
 * Katalog skill (P9, diperluas P10): gabungan skill bawaan repo (dari berkas, tidak bisa diedit) dan skill
 * tambahan dari database gateway (`user`, `installed`, `agent`). Checksum = sha256 isi (body markdown, tanpa
 * frontmatter), jadi berubah persis saat isi skill berubah, tidak saat metadata lain berubah.
 *
 * Layanan ini sinkron: data tambahan dibaca dari snapshot memori yang dijaga `SkillManager` (dimuat saat start
 * dan disegarkan setelah setiap perubahan), sehingga pemakai lama (`runner`, `bundle`, CLI) tidak ikut berubah.
 * Dibaca langsung dari `RolesService.registry()`, jadi hot-reload (mode dev) skill bawaan otomatis tercermin.
 */
export const ALL_ENGINES: readonly SkillEngine[] = ['hermes', 'omp', 'dsh'];

export interface CatalogExtra {
  id: string;
  name: string;
  description: string;
  version: string;
  body: string;
  source: Exclude<SkillSource, 'builtin'>;
  trust: SkillTrust;
  status: SkillStatus;
  engines: readonly SkillEngine[];
  pinned: boolean;
  origin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillListOptions {
  /** `active` (bawaan): hanya yang dipakai agent. `all`: juga nonaktif dan diarsipkan (halaman Skill). */
  include?: 'active' | 'all';
  engine?: SkillEngine;
}

export interface SkillsService {
  list(options?: SkillListOptions): SkillSummary[];
  get(id: string): SkillDetail | undefined;
}

export const checksumOf = (body: string): string => createHash('sha256').update(body).digest('hex');

export function createSkillsService(deps: {
  registry: () => RolesRegistry;
  /** Skill tambahan dari database (snapshot memori); default tidak ada. */
  extras?: () => Iterable<CatalogExtra>;
  /** Skill bawaan yang dinonaktifkan pengguna. */
  overrides?: () => ReadonlyMap<string, SkillStatus>;
}): SkillsService {
  const { registry, extras, overrides } = deps;
  const core = new Set<string>(CORE_SKILLS);

  const all = (): Map<string, SkillDetail> => {
    const out = new Map<string, SkillDetail>();
    const off = overrides?.();
    for (const skill of registry().skills.values()) {
      out.set(skill.id, {
        id: skill.id,
        name: skill.id,
        description: skill.description,
        version: skill.version,
        source: 'builtin',
        body: skill.body,
        checksum: checksumOf(skill.body),
        trust: 'official',
        status: off?.get(skill.id) ?? 'active',
        engines: [...ALL_ENGINES],
        pinned: core.has(skill.id),
        editable: false,
        origin: null,
      });
    }
    for (const extra of extras?.() ?? []) {
      // Id bawaan menang: skill tambahan tidak boleh menimpa skill repo.
      if (out.has(extra.id)) continue;
      out.set(extra.id, {
        id: extra.id,
        name: extra.name,
        description: extra.description,
        version: extra.version,
        source: extra.source,
        body: extra.body,
        checksum: checksumOf(extra.body),
        trust: extra.trust,
        status: extra.status,
        engines: [...extra.engines],
        pinned: extra.pinned,
        editable: true,
        origin: extra.origin,
        createdAt: extra.createdAt,
        updatedAt: extra.updatedAt,
      });
    }
    return out;
  };

  return {
    list(options = {}) {
      const { include = 'active', engine } = options;
      return [...all().values()]
        .filter((skill) => include === 'all' || skill.status === 'active')
        .filter((skill) => !engine || skill.engines?.includes(engine))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((skill): SkillSummary => {
          const { body, ...summary } = skill;
          void body; // indeks tanpa isi
          return summary;
        });
    },
    get(id) {
      return all().get(id);
    },
  };
}
