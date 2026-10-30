import type { Surface } from '@aios/contracts';

/** Dua agent tetap. Yang membedakan hanya ada tidaknya project, bukan isi pesan (ROLES_AND_SKILLS.md). */
export const GENERAL_AGENT = 'general';
export const PROJECT_AGENT = 'project';

export interface AgentContext {
  surface: Surface;
  hasProject: boolean;
}

/**
 * Chat per folder project di Windows memakai agent project (omp di worker, membaca dan mengubah folder).
 * Selain itu agent umum (Hermes di server): chat umum, dan Android yang tidak punya akses ke folder.
 */
export function pickAgent(ctx: AgentContext): string {
  return ctx.surface === 'windows' && ctx.hasProject ? PROJECT_AGENT : GENERAL_AGENT;
}

/** Paket skill: sekumpulan skill spesialis yang dimuat bersama bila pesan cocok dengan salah satu kata kuncinya. */
export interface SkillPack {
  id: string;
  skills: readonly string[];
  /** Hanya untuk agent project (butuh membaca atau mengubah kode di folder). */
  projectOnly?: boolean;
  pattern: RegExp;
}

/*
 * Urutan di sini adalah urutan pemuatan; anggaran skill (SKILLS_TOKEN_BUDGET) memangkas dari belakang.
 * Pola sengaja lebar dan murah: skill tambahan yang tidak perlu hanya memakai token, sedangkan skill yang
 * hilang menurunkan mutu. Pengguna selalu bisa menambah atau mencabut skill dari komposer.
 */
export const SKILL_PACKS: readonly SkillPack[] = [
  {
    id: 'debugging',
    skills: ['reproduce-first', 'diagnosing-bugs'],
    pattern:
      /\b(error|errors|exception|stack ?trace|traceback|crash|bug|gagal|rusak|macet|undefined|null pointer|500|404|tidak (bisa|jalan|muncul|berfungsi)|kenapa .*(error|gagal)|debug|memperbaiki|perbaiki)\b/i,
  },
  {
    id: 'frontend',
    skills: ['ui-baseline', 'a11y-check', 'ui-states', 'react-practices', 'rich-answers'],
    projectOnly: true,
    pattern:
      /\b(ui|ux|tampilan|layout|komponen|component|tombol|button|halaman|page|form|css|tailwind|style|styling|warna|responsif|responsive|navbar|modal|dialog|dark ?mode|mode gelap|react|jsx|tsx|frontend)\b/i,
  },
  {
    id: 'backend',
    skills: ['api-design', 'input-validation', 'error-handling', 'safe-migrations'],
    projectOnly: true,
    pattern:
      /\b(api|endpoint|route|rute|server|database|db|sql|query|migrasi|migration|schema|skema|auth|login|token|session|backend|middleware|webhook|orm|tabel|kolom)\b/i,
  },
  {
    id: 'review',
    skills: ['code-review', 'security-basics'],
    pattern:
      /\b(review|ulas|audit|keamanan|security|celah|vulnerab\w*|aman|diff|pull request|pr|kualitas kode|code smell)\b/i,
  },
  {
    id: 'research',
    skills: ['source-verification', 'citation', 'fact-vs-opinion'],
    pattern:
      /\b(riset|research|bandingkan|perbandingan|sumber|referensi|terbaru|terkini|tren|trend|statistik|data terbaru|harga|berita|penelitian|studi)\b/i,
  },
  {
    id: 'writing',
    skills: ['stop-slop', 'script-structure', 'audience-voice'],
    pattern:
      /\b(naskah|script|skrip video|caption|email|artikel|blog|konten|copywriting|tulis(kan)? (ulang|artikel|email|caption)|postingan|thread|newsletter|pidato)\b/i,
  },
];

export interface SkillSelection {
  /** Id paket yang cocok, berurutan. */
  packs: string[];
  /** Skill spesialis tanpa duplikat, berurutan; skill inti tidak termasuk. */
  skills: string[];
}

/**
 * Memilih skill spesialis dari isi pesan tanpa memanggil model. `extra` menambah skill pilihan pengguna dan
 * `exclude` mencabut skill (keduanya menang atas kata kunci). Skill yang tidak ada di `known` dibuang.
 */
export function selectSkills(
  text: string,
  options: {
    agent: string;
    known?: ReadonlySet<string>;
    extra?: readonly string[];
    exclude?: readonly string[];
  },
): SkillSelection {
  const { agent, known, extra = [], exclude = [] } = options;
  const packs: string[] = [];
  const skills: string[] = [];
  const add = (id: string) => {
    if (exclude.includes(id) || skills.includes(id)) return;
    if (known && !known.has(id)) return;
    skills.push(id);
  };

  for (const pack of SKILL_PACKS) {
    if (pack.projectOnly && agent !== PROJECT_AGENT) continue;
    if (!pack.pattern.test(text)) continue;
    packs.push(pack.id);
    for (const id of pack.skills) add(id);
  }
  for (const id of extra) add(id);
  return { packs, skills };
}
