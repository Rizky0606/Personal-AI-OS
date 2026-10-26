import type { Surface } from '@aios/contracts';
import type { Role, RolesRegistry } from '../registry.js';

/** Role cadangan: confidence rendah, router gagal, atau role tidak boleh dipakai di konteks ini. */
export const FALLBACK_ROLE = 'general';
/** Confidence di bawah ini berarti `general` (ROLES_AND_SKILLS.md). */
export const CONFIDENCE_THRESHOLD = 0.6;

export interface RoleContext {
  surface: Surface;
  hasProject: boolean;
}

/**
 * Role yang boleh dipilih di konteks ini.
 * - Tanpa project hanya grup Umum: Android memang begitu (dokumen); di Windows tanpa folder juga begitu
 *   karena role coding butuh worktree project untuk bekerja (asumsi, dicatat di BACKLOG).
 * - Chat per folder project di Windows hanya grup Coding: hanya role itu yang membaca folder project,
 *   jadi pertanyaan tentang project tidak boleh jatuh ke role Umum (server, tanpa akses ke project).
 */
export function candidateRoles(registry: RolesRegistry, ctx: RoleContext): Role[] {
  const all = [...registry.roles.values()];
  if (ctx.surface === 'windows' && ctx.hasProject) {
    const coding = all.filter((r) => r.group === 'coding');
    if (coding.length > 0) return coding;
  }
  const allowed = ctx.hasProject ? all : all.filter((r) => r.group === 'umum');
  const rank = (r: Role) => (r.group === 'umum' ? 0 : 1);
  return allowed
    .map((role, index) => ({ role, index }))
    .sort((a, b) => rank(a.role) - rank(b.role) || a.index - b.index)
    .map((x) => x.role);
}

/** Role cadangan: `general` bila boleh dipakai, bila tidak role pertama kandidat (chat project Windows). */
export function fallbackRole(candidates: readonly Role[]): string {
  if (candidates.some((r) => r.id === FALLBACK_ROLE)) return FALLBACK_ROLE;
  return candidates[0]?.id ?? FALLBACK_ROLE;
}

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Frasa lanjutan utuh yang tidak membawa topik baru. */
const CONTINUATION_PHRASES = new Set([
  'lanjut',
  'lanjutkan',
  'lanjutin',
  'terus',
  'oke',
  'ok',
  'okay',
  'okey',
  'ya',
  'iya',
  'yap',
  'yup',
  'yes',
  'sip',
  'siap',
  'baik',
  'boleh',
  'mantap',
  'bagus',
  'keren',
  'makasih',
  'terima kasih',
  'thanks',
  'thx',
  'coba lagi',
  'ulangi',
  'ulang',
  'lagi',
  'sekali lagi',
  'yang tadi',
  'silakan',
  'kasih contoh',
  'contoh lain',
  'versi lain',
  'yang lain',
  'lebih singkat',
  'lebih pendek',
  'lebih panjang',
  'lebih detail',
  'lebih santai',
  'lebih formal',
  'lebih sederhana',
  'jelaskan lagi',
  'jelasin lagi',
  'apa maksudnya',
]);

/** Kata pengisi: pesan yang seluruhnya terdiri dari ini ("oke lanjut aja") adalah lanjutan. */
const FILLER_WORDS = new Set([
  'oke',
  'ok',
  'ya',
  'iya',
  'sip',
  'siap',
  'lanjut',
  'lanjutkan',
  'terus',
  'dong',
  'aja',
  'saja',
  'deh',
  'nih',
  'yuk',
  'gas',
  'makasih',
  'terima',
  'kasih',
  'thanks',
  'boleh',
  'baik',
]);

const EDIT_VERB =
  /^(ubah|ganti|buat|bikin|jadikan|tambah|tambahkan|hapus|kurangi|perbesar|perkecil|pendekkan|panjangkan|perbaiki|rapikan|geser|pindahkan|tulis ulang)\b/;
const ANAPHORA = new Set(['itu', 'ini', 'tadi', 'tersebut']);

const MAX_CONTINUATION_WORDS = 4;
const MAX_CONTINUATION_CHARS = 60;

/**
 * Pesan lanjutan pendek: "lanjut", "oke", "ubah warnanya", "yang tadi". Sengaja sempit; pesan yang
 * ragu diserahkan ke model router, bukan ditebak di sini.
 */
export function isContinuation(message: string): boolean {
  if (message.length > MAX_CONTINUATION_CHARS || /```|https?:\/\//i.test(message)) return false;
  const text = normalize(message);
  if (!text) return false;
  const words = text.split(' ');
  if (words.length > MAX_CONTINUATION_WORDS) return false;
  if (CONTINUATION_PHRASES.has(text)) return true;
  if (words.every((w) => FILLER_WORDS.has(w))) return true;
  // Perintah ubah pendek yang merujuk ke hasil sebelumnya: "ubah warnanya", "ganti yang tadi".
  return (
    EDIT_VERB.test(text) &&
    words.slice(1).some((w) => (w.length > 4 && w.endsWith('nya')) || ANAPHORA.has(w))
  );
}
