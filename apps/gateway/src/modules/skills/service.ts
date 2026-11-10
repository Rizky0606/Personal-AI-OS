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
const cache = new Map<string, { checksum: string; detail: SkillDetail }>();

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
  userDir?: string;
}): SkillsService {
  const { registry, userSkills } = deps;

  const detail = (skill: {
    id: string;
    name: string;
    description: string;
    version: string;
    source: SkillSource;
    body: string;
  }): SkillDetail => {
    const checksum = checksumOf(skill.body);
    const cached = cache.get(skill.id);
    if (cached?.checksum === checksum) return cached.detail;
    const result = { ...skill, checksum };
    cache.set(skill.id, { checksum, detail: result });
    return result;
  };
  const all = (): Map<string, SkillDetail> => {
    const out = new Map<string, SkillDetail>();
    for (const skill of registry().skills.values())
      out.set(skill.id, detail({ ...skill, name: skill.id, source: 'builtin' }));
    for (const extra of userSkills?.() ?? []) out.set(extra.id, detail(extra));
    for (const id of cache.keys()) if (!out.has(id)) cache.delete(id);
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
