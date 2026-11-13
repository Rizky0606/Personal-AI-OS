import { SkillProposalBlockSchema, type SkillProposalBlock } from '@aios/contracts';

/**
 * Pengurai blok usulan skill di jawaban agent (P11). Pola yang sama dengan `parseBlock` orkestrator tim:
 * blok berpagar, JSON, divalidasi skema Zod. Semua blok `aios-skill-proposal` DIBUANG dari teks yang
 * disimpan (isinya mesin-ke-mesin, bukan untuk dibaca pemilik); blok rusak tidak membuat usulan dan tidak
 * merusak jawaban. Pagar yang tidak ditutup tidak bisa dibatasi dengan pasti, jadi dibiarkan.
 */
const FENCE = /```aios-skill-proposal[ \t]*\r?\n([\s\S]*?)```/g;

export type ProposalRejection = 'json' | 'schema' | 'secret' | 'frontmatter' | 'extra';

export interface ProposalExtraction {
  /** Teks jawaban tanpa blok usulan. */
  text: string;
  /** Jumlah blok berpagar yang ditemukan (valid atau tidak). */
  found: number;
  /** Usulan pertama yang lolos semua pemeriksaan; maksimal satu per jawaban. */
  accepted: SkillProposalBlock | null;
  /** Alasan tiap blok yang tidak dipakai; tidak pernah memuat isi blok (bisa berisi rahasia). */
  rejected: ProposalRejection[];
}

/** Aturan pendeteksi rahasia. Hanya nama aturan yang pernah dilaporkan, tidak pernah nilainya. */
const SECRET_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    name: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  },
  { name: 'api-key-sk', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  { name: 'url-credentials', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i },
];

/** Penugasan `kunci = nilai` untuk kunci yang jelas rahasia, dengan nilai literal (bukan placeholder). */
const SECRET_ASSIGNMENT =
  /\b(?:password|passwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|auth[_-]?token|token)\b["']?\s*[:=]\s*["']?([^\s"'<>{}$`,;()[\]]{12,})/gi;

/** Nama aturan rahasia pertama yang cocok, atau null. */
export function findSecret(text: string): string | null {
  for (const rule of SECRET_RULES) if (rule.pattern.test(text)) return rule.name;
  for (const match of text.matchAll(SECRET_ASSIGNMENT)) {
    const value = match[1] ?? '';
    // Nilai harus tampak seperti rahasia (huruf dan angka bercampur), bukan kata biasa.
    if (/[A-Za-z]/.test(value) && /\d/.test(value)) return 'secret-assignment';
  }
  return null;
}

/** Isi katalog tidak boleh diawali blok frontmatter (sama dengan pemeriksaan di SkillManager). */
const STARTS_WITH_FRONTMATTER = /^\s*---\s*\r?\n/;

function check(raw: string): { block: SkillProposalBlock } | { reject: ProposalRejection } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { reject: 'json' };
  }
  const parsed = SkillProposalBlockSchema.safeParse(json);
  if (!parsed.success) return { reject: 'schema' };
  const block = parsed.data;
  if (STARTS_WITH_FRONTMATTER.test(block.body)) return { reject: 'frontmatter' };
  if (findSecret([block.name, block.description, block.body, block.reason].join('\n'))) {
    return { reject: 'secret' };
  }
  return { block };
}

/** Membuang blok dan merapikan baris kosong yang tertinggal; bagian lain jawaban tidak diubah. */
function strip(text: string): string {
  return text
    .replace(FENCE, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

export function extractProposals(text: string): ProposalExtraction {
  const rejected: ProposalRejection[] = [];
  let accepted: SkillProposalBlock | null = null;
  let found = 0;
  for (const match of text.matchAll(FENCE)) {
    found += 1;
    const outcome = check(match[1] ?? '');
    if ('reject' in outcome) {
      rejected.push(outcome.reject);
    } else if (accepted) {
      rejected.push('extra'); // maksimal satu usulan per jawaban
    } else {
      accepted = outcome.block;
    }
  }
  return { text: found === 0 ? text : strip(text), found, accepted, rejected };
}
