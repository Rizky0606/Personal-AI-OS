import { createHash } from 'node:crypto';
import { SKILL_BODY_MAX_BYTES } from '@aios/contracts';
import { AppError } from '../../errors.js';

/**
 * Pemasangan skill dari luar (P10). HANYA gateway yang mengunduh; klien tidak pernah. Yang diterima:
 *   - id skills.sh:        pemilik/repo@skill
 *   - URL skills.sh:       https://skills.sh/pemilik/repo/skill
 *   - URL GitHub folder:   https://github.com/pemilik/repo/tree/<ref>/<jalur-folder>
 *   - URL SKILL.md:        https://github.com/.../blob/<ref>/.../SKILL.md atau raw.githubusercontent.com/...
 * Yang diunduh hanya `SKILL.md` (teks, maks 64 KB). Folder `scripts/` dan berkas eksekusi TIDAK diunduh dan
 * tidak pernah dijalankan; bila isi skill merujuknya, pratinjau memberi peringatan. Tidak menjalankan apa pun.
 */
export const ALLOWED_HOSTS: readonly string[] = [
  'github.com',
  'raw.githubusercontent.com',
  'skills.sh',
];
export const MAX_SKILL_MD_BYTES = SKILL_BODY_MAX_BYTES;
/** Batas total semua berkas dari satu pemasangan (SKILL.md + berkas teks pendukung bila kelak diunduh). */
export const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

export type FetchLike = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

export interface ResolvedSource {
  kind: 'skills.sh' | 'github' | 'raw';
  /** Sumber seperti yang dimasukkan pengguna (disimpan sebagai `origin`). */
  input: string;
  /** Kandidat URL SKILL.md, dicoba berurutan. */
  candidates: string[];
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const invalid = (detail: string) => new AppError(422, 'skill_source_invalid', detail);

export const isAllowedUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      (url.port === '' || url.port === '443') &&
      ALLOWED_HOSTS.includes(url.hostname)
    );
  } catch {
    return false;
  }
};

const raw = (owner: string, repo: string, ref: string, path: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`.replace(/\/+$/, '');

/** Mengurai sumber menjadi kandidat URL SKILL.md di domain yang diizinkan; menolak yang lain. */
export function resolveSource(input: string): ResolvedSource {
  const text = input.trim();
  if (text === '' || text.length > 500) throw invalid('Sumber kosong atau terlalu panjang.');

  const shId = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)$/.exec(text);
  if (shId) {
    const [, owner, repo, skill] = shId as unknown as [string, string, string, string];
    return {
      kind: 'skills.sh',
      input: text,
      candidates: ['main', 'master'].flatMap((ref) => [
        raw(owner, repo, ref, `skills/${skill}/SKILL.md`),
        raw(owner, repo, ref, `${skill}/SKILL.md`),
        raw(owner, repo, ref, `.claude/skills/${skill}/SKILL.md`),
        raw(owner, repo, ref, `.agents/skills/${skill}/SKILL.md`),
      ]),
    };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid('Sumber harus id skills.sh (pemilik/repo@skill) atau URL https yang diizinkan.');
  }
  if (!isAllowedUrl(url.href))
    throw new AppError(
      422,
      'skill_domain_not_allowed',
      `Domain "${url.hostname}" tidak diizinkan. Yang diizinkan: ${ALLOWED_HOSTS.join(', ')} (https).`,
    );
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || !SEGMENT.test(p.replace(/%20/g, '_'))))
    throw invalid('Jalur URL tidak valid.');

  if (url.hostname === 'skills.sh') {
    const [owner, repo, skill] = parts;
    if (!owner || !repo || !skill || parts.length !== 3)
      throw invalid('URL skills.sh harus berbentuk https://skills.sh/pemilik/repo/skill.');
    return resolveSource(`${owner}/${repo}@${skill}`);
  }
  if (url.hostname === 'raw.githubusercontent.com') {
    if (!/SKILL\.md$/i.test(url.pathname)) throw invalid('URL raw harus menunjuk berkas SKILL.md.');
    return { kind: 'raw', input: text, candidates: [url.href] };
  }
  // github.com/<owner>/<repo>/(tree|blob)/<ref>/<path...>
  const [owner, repo, mode, ref, ...rest] = parts;
  if (!owner || !repo || !ref || (mode !== 'tree' && mode !== 'blob'))
    throw invalid(
      'URL GitHub harus menunjuk folder skill: github.com/pemilik/repo/tree/<ref>/<folder>.',
    );
  const path = rest.join('/');
  const file = /SKILL\.md$/i.test(path) ? path : `${path}/SKILL.md`.replace(/^\/+/, '');
  return { kind: 'github', input: text, candidates: [raw(owner, repo, ref, file)] };
}

/** Unduh teks dari URL yang diizinkan: tanpa redirect keluar domain, dengan batas ukuran dan waktu. */
export async function fetchSkillText(
  start: string,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<{ status: 'ok'; text: string; url: string } | { status: 'missing' }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedUrl(url))
      throw new AppError(
        422,
        'skill_domain_not_allowed',
        'Pengalihan ke domain yang tidak diizinkan ditolak.',
      );
    let res: Response;
    try {
      res = await fetchImpl(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'text/plain, text/markdown;q=0.9', 'user-agent': 'aios-gateway' },
      });
    } catch {
      throw new AppError(
        502,
        'skill_fetch_failed',
        'Gagal mengunduh skill (jaringan atau waktu habis).',
        undefined,
        undefined,
      );
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new AppError(502, 'skill_fetch_failed', 'Pengalihan tanpa tujuan.');
      url = new URL(next, url).href;
      continue;
    }
    if (res.status === 404) return { status: 'missing' };
    if (!res.ok)
      throw new AppError(502, 'skill_fetch_failed', `Sumber menjawab HTTP ${res.status}.`);
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type !== '' && !/^(text\/|application\/(json|x-yaml|yaml))/.test(type))
      throw new AppError(
        422,
        'skill_not_text',
        `Jenis konten "${type}" ditolak; hanya berkas teks.`,
      );
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_SKILL_MD_BYTES) throw tooLarge();
    if (!res.body) throw new AppError(502, 'skill_fetch_failed', 'Sumber tidak mengirim isi.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Dibaca bertahap dan dihentikan begitu melewati batas, jadi server yang berbohong soal ukuran tidak
    // bisa memenuhi memori.
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_SKILL_MD_BYTES) throw tooLarge();
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.includes(0))
      throw new AppError(422, 'skill_not_text', 'Berkas biner ditolak; hanya teks.');
    try {
      return { status: 'ok', text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), url };
    } catch {
      throw new AppError(422, 'skill_not_text', 'Isi bukan teks UTF-8 yang valid.');
    }
  }
  throw new AppError(502, 'skill_fetch_failed', 'Terlalu banyak pengalihan.');
}

const tooLarge = () =>
  new AppError(
    422,
    'skill_too_large',
    `SKILL.md melebihi ${MAX_SKILL_MD_BYTES / 1024} KB; tidak dipasang.`,
  );

export interface ParsedSkillMd {
  name: string;
  description: string;
  body: string;
  descriptionTrimmed: boolean;
}

const unquote = (value: string): string => {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  )
    return v.slice(1, -1).replace(/\\"/g, '"');
  return v;
};

/** Mengurai SKILL.md dengan frontmatter sederhana (tanpa pustaka YAML): name, description (satu baris atau > / |). */
export function parseSkillMd(text: string): ParsedSkillMd {
  const clean = text.replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(clean);
  if (!m) throw invalid('SKILL.md tidak punya frontmatter (--- name, description ---).');
  const fields = new Map<string, string>();
  const lines = (m[1] ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    const [, key, rest] = kv as unknown as [string, string, string];
    if (/^[>|][+-]?$/.test(rest.trim())) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1]!))
        block.push(lines[++i]!.trim());
      fields.set(key, block.join(rest.trim().startsWith('>') ? ' ' : '\n').trim());
    } else fields.set(key, unquote(rest));
  }
  const name = fields.get('name')?.trim();
  const description = (fields.get('description') ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw invalid('Frontmatter SKILL.md tidak punya "name".');
  if (!description) throw invalid('Frontmatter SKILL.md tidak punya "description".');
  const body = (m[2] ?? '').replace(/^\s*\r?\n/, '');
  if (body.trim() === '') throw invalid('SKILL.md tidak punya isi.');
  const trimmed = description.length > 200;
  return {
    name: name.slice(0, 80),
    description: trimmed ? `${description.slice(0, 199).replace(/\s+\S*$/, '')}…` : description,
    body,
    descriptionTrimmed: trimmed,
  };
}

export const checksumOfBody = (body: string): string =>
  createHash('sha256').update(body).digest('hex');

/** Isi skill merujuk skrip/berkas eksekusi yang TIDAK diunduh dan tidak akan dijalankan. */
export const mentionsScripts = (body: string): boolean =>
  /(^|[\s`"'(/])scripts\/[\w.-]+|\.(sh|ps1|bat|cmd|exe|py)\b/i.test(body);

export interface FetchedSkill extends ParsedSkillMd {
  url: string;
  checksum: string;
  mentionsScripts: boolean;
}

/** Mencoba tiap kandidat URL sampai ada yang ada; 404 untuk semuanya = sumber tidak ditemukan. */
export async function fetchSkill(
  source: ResolvedSource,
  fetchImpl?: FetchLike,
): Promise<FetchedSkill> {
  for (const candidate of source.candidates) {
    const result = await fetchSkillText(candidate, fetchImpl);
    if (result.status === 'missing') continue;
    const parsed = parseSkillMd(result.text);
    return {
      ...parsed,
      url: result.url,
      checksum: checksumOfBody(parsed.body),
      mentionsScripts: mentionsScripts(parsed.body),
    };
  }
  throw new AppError(404, 'skill_source_not_found', 'SKILL.md tidak ditemukan di sumber itu.');
}
