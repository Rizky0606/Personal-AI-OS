import { createHash } from 'node:crypto';
import type { RolesRegistry } from '@aios/roles';
import type { SkillDetail, SkillSource, SkillSummary } from '@aios/contracts';

/**
 * Katalog skill (P9): gabungan skill bawaan repo (`registry()`) + skill tambahan dari folder data gateway
 * (`user`, disiapkan untuk P10 -- belum ada pemuat folder itu sesi ini, daftar tetap kosong). Checksum = sha256
 * isi (body markdown, tanpa frontmatter), jadi berubah persis saat isi skill berubah, tidak saat metadata lain
 * berubah. Dibaca langsung dari `RolesService.registry()`, jadi hot-reload (mode dev) otomatis tercermin di sini.
 */
export interface SkillsService {
  list(): SkillSummary[];
  get(id: string): SkillDetail | undefined;
}

const checksumOf = (body: string): string => createHash('sha256').update(body).digest('hex');

export function createSkillsService(deps: {
  registry: () => RolesRegistry;
  /** Skill dari folder user (P10); default tidak ada skill tambahan. */
  userSkills?: () => Iterable<{
    id: string;
    name: string;
    description: string;
    version: string;
    body: string;
    source: Exclude<SkillSource, 'builtin'>;
  }>;
}): SkillsService {
  const { registry, userSkills } = deps;

  const all = (): Map<string, SkillDetail> => {
    const out = new Map<string, SkillDetail>();
    for (const skill of registry().skills.values()) {
      out.set(skill.id, {
        id: skill.id,
        name: skill.id,
        description: skill.description,
        version: skill.version,
        source: 'builtin',
        checksum: checksumOf(skill.body),
        body: skill.body,
      });
    }
    for (const extra of userSkills?.() ?? []) {
      out.set(extra.id, {
        id: extra.id,
        name: extra.name,
        description: extra.description,
        version: extra.version,
        source: extra.source,
        checksum: checksumOf(extra.body),
        body: extra.body,
      });
    }
    return out;
  };

  return {
    list() {
      return [...all().values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          version: skill.version,
          source: skill.source,
          checksum: skill.checksum,
        }));
    },
    get(id) {
      return all().get(id);
    },
  };
}
