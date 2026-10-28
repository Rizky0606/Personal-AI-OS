import { copy } from '../copy';

/**
 * Paket skill yang bisa ditambahkan pemilik untuk pesan berikutnya. Isi paket mengikuti `SKILL_PACKS` di
 * packages/roles; server membuang skill yang tidak dikenal, jadi daftar yang kedaluwarsa tidak merusak apa pun.
 */
export const SKILL_PACKS = [
  { id: 'debugging', skills: ['reproduce-first', 'diagnosing-bugs'], projectOnly: false },
  {
    id: 'frontend',
    skills: ['ui-baseline', 'a11y-check', 'ui-states', 'react-practices'],
    projectOnly: true,
  },
  {
    id: 'backend',
    skills: ['api-design', 'input-validation', 'error-handling', 'safe-migrations'],
    projectOnly: true,
  },
  { id: 'review', skills: ['code-review', 'security-basics'], projectOnly: false },
  {
    id: 'research',
    skills: ['source-verification', 'citation', 'fact-vs-opinion'],
    projectOnly: false,
  },
  {
    id: 'writing',
    skills: ['stop-slop', 'script-structure', 'audience-voice'],
    projectOnly: false,
  },
] as const;

/** Paket yang ditawarkan di konteks ini; paket tampilan dan server hanya untuk chat project. */
export function packOptions(inProject: boolean) {
  return SKILL_PACKS.filter((p) => inProject || !p.projectOnly).map((p) => ({
    value: p.id,
    label: copy.chat.skills.packs[p.id],
  }));
}

/** Skill dari paket terpilih, tanpa duplikat; undefined bila tidak ada pilihan. */
export function skillsOfPacks(ids: readonly string[]): string[] | undefined {
  const skills = SKILL_PACKS.filter((p) => ids.includes(p.id)).flatMap((p) => p.skills);
  return skills.length > 0 ? [...new Set<string>(skills)] : undefined;
}
