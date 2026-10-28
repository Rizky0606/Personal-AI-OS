import { CORE_SKILLS } from './schema.js';
import type { RolesRegistry } from './registry.js';

/**
 * Aturan perilaku agent di dalam aplikasi (ROLES_AND_SKILLS.md), disuntik ke semua role
 * bersama skill inti. Berlaku untuk agent yang berjalan di aplikasi, bukan yang membangunnya.
 */
export const AGENT_BEHAVIOR_RULES = [
  'Jawab dalam bahasa pengguna. Langsung ke jawaban, tanpa basa-basi.',
  'Jangan mengarang fakta, path file, atau hasil perintah. Jika tidak tahu, katakan dan tawarkan cara mencari tahu.',
  'Perintah yang mengubah sistem, menghapus file, atau mengakses jaringan selalu melalui approval kecuali ada aturan "selalu izinkan" untuk project itu.',
  'Tidak pernah membaca atau mengirim file .env, kunci SSH, atau folder di luar project tanpa izin eksplisit.',
];

/** Anggaran skill per run (~4.000 token, ROLES_AND_SKILLS.md). */
export const SKILLS_TOKEN_BUDGET = 4000;
/**
 * Anggaran seluruh bundel (aturan + role + skill). Dokumen hanya menetapkan anggaran skill;
 * angka ini asumsi agar system prompt tidak membengkak.
 */
export const BUNDLE_TOKEN_BUDGET = 6000;

/** Perkiraan kasar (tanpa tokenizer): ~3,5 karakter per token, sengaja condong ke jumlah token yang lebih besar. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export class UnknownRoleError extends Error {
  constructor(readonly roleId: string) {
    super(`Role "${roleId}" tidak ada`);
    this.name = 'UnknownRoleError';
  }
}

export interface Bundle {
  roleId: string;
  /** Pesan sistem lengkap untuk mesin agent. */
  systemPrompt: string;
  /** Skill yang disuntik, berurutan: inti dulu, lalu khusus. */
  skills: string[];
  /** Skill khusus yang dilewati karena anggaran skill habis. */
  omittedSkills: string[];
  tokens: { rules: number; role: number; skills: number; total: number };
  overBudget: boolean;
}

export interface BundleOptions {
  skillsBudget?: number;
  bundleBudget?: number;
  /** Skill spesialis tambahan untuk permintaan ini (hasil `selectSkills`), setelah skill milik agent. */
  extraSkills?: readonly string[];
}

/**
 * system prompt = aturan perilaku + isi role + skill inti + skill khusus.
 * Skill inti selalu masuk. Skill khusus masuk berurutan selama muat di anggaran skill;
 * yang tidak muat dilewati (dilaporkan di `omittedSkills`), bukan dipotong di tengah.
 */
export function buildBundle(
  registry: RolesRegistry,
  roleId: string,
  {
    skillsBudget = SKILLS_TOKEN_BUDGET,
    bundleBudget = BUNDLE_TOKEN_BUDGET,
    extraSkills = [],
  }: BundleOptions = {},
): Bundle {
  const role = registry.roles.get(roleId);
  if (!role) throw new UnknownRoleError(roleId);

  const rules = `# Aturan perilaku agent\n${AGENT_BEHAVIOR_RULES.map((r) => `- ${r}`).join('\n')}`;
  const roleSection = `# Peran: ${role.name}\n${role.body}`;

  const section = (id: string) => {
    const skill = registry.skills.get(id);
    return skill ? `## ${id}\n${skill.body}` : undefined;
  };

  const included: string[] = [];
  const omitted: string[] = [];
  const core: string[] = [];
  const extra: string[] = [];
  let skillTokens = 0;

  for (const id of CORE_SKILLS) {
    const text = section(id);
    if (!text) continue;
    core.push(text);
    included.push(id);
    skillTokens += estimateTokens(text);
  }
  for (const id of new Set([...role.skills, ...extraSkills])) {
    if ((CORE_SKILLS as readonly string[]).includes(id)) continue;
    const text = section(id);
    if (!text) continue;
    const cost = estimateTokens(text);
    if (skillTokens + cost > skillsBudget) {
      omitted.push(id);
      continue;
    }
    extra.push(text);
    included.push(id);
    skillTokens += cost;
  }

  const parts = [
    rules,
    roleSection,
    `# Skill inti\n\n${core.join('\n\n')}`,
    ...(extra.length > 0 ? [`# Skill khusus\n\n${extra.join('\n\n')}`] : []),
  ];
  const systemPrompt = parts.join('\n\n');
  const total = estimateTokens(systemPrompt);

  return {
    roleId,
    systemPrompt,
    skills: included,
    omittedSkills: omitted,
    tokens: {
      rules: estimateTokens(rules),
      role: estimateTokens(roleSection),
      skills: skillTokens,
      total,
    },
    overBudget: total > bundleBudget || skillTokens > skillsBudget,
  };
}
