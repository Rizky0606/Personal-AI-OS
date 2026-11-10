import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Prefiks nama skill di Hermes supaya tidak bentrok dengan skill bawaan atau milik pengguna. */
export const HERMES_SKILL_PREFIX = 'aios-';
/** Satu-satunya subfolder di folder skill Hermes yang boleh ditulis atau dihapus modul ini. */
export const HERMES_SKILL_FOLDER = 'aios';

const ID = /^[a-z][a-z0-9-]*$/;

export interface HermesSyncSkill {
  id: string;
  description: string;
  version: string;
  body: string;
}

export interface HermesSyncResult {
  written: string[];
  unchanged: string[];
  removed: string[];
  /** Folder di aios/ yang bukan buatan modul ini (tidak diawali nama aios-) dan dibiarkan. */
  skipped: string[];
}

export const hermesSkillFile = (skill: HermesSyncSkill): string =>
  [
    '---',
    `name: ${HERMES_SKILL_PREFIX}${skill.id}`,
    `description: ${JSON.stringify(skill.description)}`,
    `version: ${JSON.stringify(skill.version)}`,
    '---',
    '',
    skill.body,
    '',
  ].join('\n');

const nameOf = (text: string): string | undefined =>
  /^name:\s*(\S+)\s*$/m.exec(text.split(/\r?\n---/)[0] ?? '')?.[1];

/**
 * Menyalin katalog ke `<root>/aios/<id>/SKILL.md` dengan nama `aios-<id>`. Hanya folder `aios/` yang disentuh:
 * folder lain di `root` (milik Hermes atau pengguna) tidak dibaca, ditulis, maupun dihapus. Folder di `aios/`
 * yang namanya tidak diawali `aios-` dianggap bukan milik kita dan dibiarkan. Symlink ditolak (bukan diikuti)
 * supaya penyalinan tidak bisa keluar dari `aios/`.
 */
export async function syncHermesSkills(
  skills: readonly HermesSyncSkill[],
  options: { root: string; dryRun?: boolean; prune?: boolean },
): Promise<HermesSyncResult> {
  const root = resolve(options.root);
  const target = join(root, HERMES_SKILL_FOLDER);
  const inside = (path: string) => resolve(path).startsWith(target + sep);
  const result: HermesSyncResult = { written: [], unchanged: [], removed: [], skipped: [] };

  for (const skill of skills) {
    if (!ID.test(skill.id)) throw new Error(`Id skill tidak valid untuk Hermes: ${skill.id}`);
  }
  try {
    if ((await lstat(root)).isSymbolicLink())
      throw new Error('Folder skill Hermes tidak boleh symlink.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Folder skill Hermes tidak ada: ${root}`, { cause: error });
    throw error;
  }
  try {
    if ((await lstat(target)).isSymbolicLink())
      throw new Error('Folder aios/ tidak boleh symlink.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!options.dryRun) await mkdir(target, { recursive: true });

  const wanted = new Set(skills.map((s) => s.id));
  for (const skill of skills) {
    const dir = join(target, skill.id);
    const file = join(dir, 'SKILL.md');
    if (!inside(file)) throw new Error(`Jalur keluar dari aios/: ${skill.id}`);
    try {
      if ((await lstat(dir)).isSymbolicLink())
        throw new Error(`aios/${skill.id} adalah symlink; ditolak.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const content = hermesSkillFile(skill);
    const existing = await readFile(file, 'utf8').catch(() => undefined);
    if (existing === content) {
      result.unchanged.push(skill.id);
      continue;
    }
    if (existing !== undefined && nameOf(existing) !== `${HERMES_SKILL_PREFIX}${skill.id}`) {
      result.skipped.push(skill.id); // berkas ada tetapi bukan buatan kita
      continue;
    }
    if (!options.dryRun) {
      await mkdir(dir, { recursive: true });
      await writeFile(file, content);
    }
    result.written.push(skill.id);
  }

  const present = await readdir(target, { withFileTypes: true }).catch(() => []);
  for (const entry of options.prune === false ? [] : present) {
    if (wanted.has(entry.name) || !entry.isDirectory()) continue;
    const file = join(target, entry.name, 'SKILL.md');
    const text = await readFile(file, 'utf8').catch(() => undefined);
    if (text === undefined || !nameOf(text)?.startsWith(HERMES_SKILL_PREFIX)) {
      result.skipped.push(entry.name);
      continue;
    }
    if (!options.dryRun) await rm(join(target, entry.name), { recursive: true, force: true });
    result.removed.push(entry.name);
  }
  return result;
}

/** Skill katalog yang harus ada di Hermes: aktif dan mesin `hermes` termasuk di daftar mesinnya. */
export function hermesSkillsFor(catalog: {
  list(options?: { engine?: 'hermes' }): { id: string }[];
  get(id: string): { id: string; description: string; version: string; body: string } | undefined;
}): HermesSyncSkill[] {
  return catalog.list({ engine: 'hermes' }).flatMap((entry) => {
    const detail = catalog.get(entry.id);
    return detail
      ? [
          {
            id: detail.id,
            description: detail.description,
            version: detail.version,
            body: detail.body,
          },
        ]
      : [];
  });
}
