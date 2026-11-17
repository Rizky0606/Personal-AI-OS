import { z } from 'zod';
import { AppError } from '../../errors.js';

/**
 * aitmpl.com (Claude Code Templates) sebagai sumber skill. Hanya tipe `skills` yang diimpor: tipe lain
 * (hooks, mcps, mods) menjalankan kode dengan hak akses lokal, dan (agents, commands, settings, loops) memberi
 * perintah atau izin yang tidak bisa dinilai pemindai SKILL.md. Penolakan dilakukan di sini, sebelum unduhan.
 */
export const AITMPL_HOST = 'www.aitmpl.com';

/** Tipe katalog aitmpl yang TIDAK boleh dipasang. Nama `mcp` ikut dijaga selain `mcps` (nama katalog). */
export const REFUSED_AITMPL_TYPES: readonly string[] = [
  'agents',
  'commands',
  'hooks',
  'mcps',
  'mcp',
  'settings',
  'loops',
  'mods',
  'plugins',
  'templates',
  'sandboxes',
];

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface AitmplSkillRef {
  category: string;
  name: string;
}

/** Satu-satunya tempat penolakan tipe: id dan URL sama-sama lewat sini. */
function assertSkillsType(type: string): void {
  if (type === 'skills') return;
  throw new AppError(
    422,
    'skill_type_not_importable',
    `Tipe "${type}" tidak bisa dipasang dari aitmpl.com; hanya "skills" yang diimpor. ` +
      'Hooks, MCP, dan mods menjalankan kode dengan hak akses lokal Claude Code, sedangkan agents, commands, ' +
      'settings, dan loops memberi perintah atau izin yang tidak bisa dinilai pemindai SKILL.md.',
  );
}

/**
 * Bentuk id: `<kategori>/<nama>` (skills) atau `<tipe>/<kategori>/<nama>` (id katalog aitmpl).
 * Mengembalikan null bila bukan bentuk id aitmpl (biarkan pemanggil mencoba bentuk lain).
 */
export function aitmplIdOf(text: string): AitmplSkillRef | null {
  const parts = text.split('/');
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!parts.every((p) => SEGMENT.test(p))) return null;
  const [first, ...rest] = parts as [string, ...string[]];
  if (parts.length === 2) {
    if (REFUSED_AITMPL_TYPES.includes(first)) assertSkillsType(first);
    return { category: first, name: rest[0]! };
  }
  if (first !== 'skills' && !REFUSED_AITMPL_TYPES.includes(first)) return null;
  assertSkillsType(first);
  return { category: rest[0]!, name: rest[1]! };
}

/** Bentuk URL: `/component/<tipe>/<kategori>/<nama>` atau `/component-content/<tipe>/<kategori>/<nama>.json`. */
export function aitmplUrlOf(pathParts: string[]): AitmplSkillRef {
  const [kind, type, category, file] = pathParts;
  if (
    pathParts.length !== 4 ||
    (kind !== 'component' && kind !== 'component-content') ||
    !type ||
    !category ||
    !file
  ) {
    throw new AppError(
      422,
      'skill_source_invalid',
      'URL aitmpl harus menunjuk komponen: https://www.aitmpl.com/component/skills/<kategori>/<nama>.',
    );
  }
  assertSkillsType(type);
  const name = file.replace(/\.json$/i, '');
  if (!SEGMENT.test(category) || !SEGMENT.test(name)) {
    throw new AppError(422, 'skill_source_invalid', 'Kategori atau nama aitmpl tidak valid.');
  }
  return { category, name };
}

/** Alamat kanonis: dipakai sebagai `origin` agar id dan URL dari skill yang sama dianggap sama. */
export const aitmplPageUrl = (ref: AitmplSkillRef) =>
  `https://${AITMPL_HOST}/component/skills/${ref.category}/${ref.name}`;

export const aitmplContentUrl = (ref: AitmplSkillRef) =>
  `https://${AITMPL_HOST}/component-content/skills/${ref.category}/${ref.name}.json`;

/** Bentuk nyata `/component-content/skills/<kategori>/<nama>.json` (diperiksa 2026-11-17): `content` = SKILL.md lengkap. */
const ComponentContentSchema = z
  .object({
    content: z.string(),
    meta: z
      .object({ files: z.array(z.object({ path: z.string() }).passthrough()).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Mengambil teks SKILL.md dari balasan JSON aitmpl; bentuk lain ditolak dengan 422 yang jelas. */
export function skillMdOfComponent(json: string): string {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new AppError(
      422,
      'skill_source_invalid',
      'Isi aitmpl.com tidak dikenali: balasan bukan JSON.',
    );
  }
  const parsed = ComponentContentSchema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(
      422,
      'skill_source_invalid',
      'Isi aitmpl.com tidak dikenali: tidak ada "content" berupa teks SKILL.md.',
    );
  }
  return parsed.data.content;
}
