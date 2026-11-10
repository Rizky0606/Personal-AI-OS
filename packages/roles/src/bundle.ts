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
  /** Skill yang isinya ditempel utuh, berurutan: inti dulu, lalu milik agent/manual. */
  skills: string[];
  /**
   * Skill yang hanya ditawarkan lewat indeks (id + deskripsi), TANPA isi ditempel (P9: agent memilih sendiri
   * dari indeks, lihat ROLES_AND_SKILLS.md "Paket skill"). Kosong bila `eagerSkillPacks` dipakai.
   */
  offeredSkills: string[];
  /** Skill khusus yang dilewati karena anggaran skill habis. */
  omittedSkills: string[];
  tokens: { rules: number; role: number; skills: number; total: number };
  overBudget: boolean;
}

export interface BundleOptions {
  skillsBudget?: number;
  bundleBudget?: number;
  /** Skill spesialis tambahan untuk permintaan ini (pilihan manual pengguna): isinya DITEMPEL UTUH. */
  extraSkills?: readonly string[];
  /**
   * Skill paket kata kunci (P9): hanya ditawarkan lewat indeks (id + deskripsi) di bagian baru
   * "Skill tersedia", TIDAK ditempel utuh secara bawaan -- agent memilih sendiri mana yang relevan.
   * Skill yang sama juga ada di `extraSkills` (mis. pilihan manual pengguna) tetap ditempel utuh;
   * daftar ini hanya menurunkan status skill yang BELUM diminta eksplisit.
   */
  suggestedSkills?: readonly string[];
  /**
   * Fallback P9 untuk mesin tanpa dukungan indeks skill (mis. belum diaudit): `suggestedSkills`
   * ditempel utuh juga, seperti perilaku sebelum P9. Default false.
   */
  eagerSkillPacks?: boolean;
  /**
   * Awalan nama skill di baris indeks. Nama yang ditampilkan harus sama dengan nama yang bisa dibuka mesin:
   * omp membuka `skill://<id>` (tanpa awalan), Hermes membuka skill hasil sinkron bernama `aios-<id>`.
   */
  skillNamePrefix?: string;
}

/**
 * system prompt = aturan perilaku + isi role + skill inti + skill khusus (ditempel utuh) + indeks skill
 * yang ditawarkan (P9, hanya id+deskripsi). Skill inti selalu masuk utuh. Skill milik agent dan skill
 * manual (`extraSkills`) masuk berurutan selama muat di anggaran skill; yang tidak muat dilewati
 * (dilaporkan di `omittedSkills`), bukan dipotong di tengah. Skill `suggestedSkills` yang belum diminta
 * eksplisit (tidak ada di `extraSkills`/skill milik agent) hanya masuk sebagai baris indeks, tidak
 * dihitung ke anggaran skill (deskripsinya pendek, maks 200 karakter).
 */
export function buildBundle(
  registry: RolesRegistry,
  roleId: string,
  {
    skillsBudget = SKILLS_TOKEN_BUDGET,
    bundleBudget = BUNDLE_TOKEN_BUDGET,
    extraSkills = [],
    suggestedSkills = [],
    eagerSkillPacks = false,
    skillNamePrefix = '',
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
  const offered: string[] = [];
  const offeredIndex: string[] = [];
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

  const extraSet = new Set(extraSkills);
  // Hanya "tawarkan lewat indeks" (bukan tempel utuh) bila BELUM diminta eksplisit sebagai skill milik
  // agent atau pilihan manual (extraSkills); permintaan eksplisit selalu menang.
  const indexOnly = eagerSkillPacks
    ? new Set<string>()
    : new Set(
        suggestedSkills.filter(
          (id) =>
            !role.skills.includes(id) &&
            !extraSet.has(id) &&
            !(CORE_SKILLS as readonly string[]).includes(id),
        ),
      );
  const candidates = eagerSkillPacks
    ? new Set([...role.skills, ...extraSkills, ...suggestedSkills])
    : new Set([...role.skills, ...extraSkills]);

  for (const id of candidates) {
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

  for (const id of indexOnly) {
    const skill = registry.skills.get(id);
    if (!skill) continue;
    offered.push(id);
    offeredIndex.push(`- ${skillNamePrefix}${id}: ${skill.description}`);
  }

  const parts = [
    rules,
    roleSection,
    `# Skill inti\n\n${core.join('\n\n')}`,
    ...(extra.length > 0 ? [`# Skill khusus\n\n${extra.join('\n\n')}`] : []),
    ...(offeredIndex.length > 0
      ? [`# Skill tersedia (buka bila relevan dengan permintaan ini)\n${offeredIndex.join('\n')}`]
      : []),
  ];
  const systemPrompt = parts.join('\n\n');
  const total = estimateTokens(systemPrompt);

  return {
    roleId,
    systemPrompt,
    skills: included,
    offeredSkills: offered,
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
