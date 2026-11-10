import { describe, expect, it } from 'vitest';
import {
  MAX_SKILL_MD_BYTES,
  fetchSkill,
  fetchSkillText,
  isAllowedUrl,
  mentionsScripts,
  parseSkillMd,
  resolveSource,
  type FetchLike,
} from './installer.js';

const md = (body = 'Isi skill.', extra = '') =>
  `---\nname: naskah-anak\ndescription: Saat menulis naskah anak.\n${extra}---\n${body}\n`;

const reply = (text: string | Uint8Array, init: ResponseInit = {}) =>
  new Response(new Blob([text]), {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    ...init,
  });

/** fetch palsu berbasis peta URL -> Response; mencatat semua URL yang diminta. */
const fake = (routes: Record<string, () => Response>) => {
  const seen: string[] = [];
  const impl: FetchLike = (url) => {
    seen.push(url);
    const make = routes[url];
    return Promise.resolve(make ? make() : new Response('', { status: 404 }));
  };
  return { impl, seen };
};

describe('resolveSource', () => {
  it('id skills.sh -> kandidat raw.githubusercontent.com', () => {
    const r = resolveSource('vercel-labs/agent-skills@react-best-practices');
    expect(r.kind).toBe('skills.sh');
    expect(r.candidates[0]).toBe(
      'https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md',
    );
    expect(r.candidates.every((c) => isAllowedUrl(c))).toBe(true);
  });

  it('URL skills.sh dan URL folder GitHub', () => {
    expect(resolveSource('https://skills.sh/anthropics/skills/pdf').kind).toBe('skills.sh');
    const gh = resolveSource('https://github.com/anthropics/skills/tree/main/skills/pdf');
    expect(gh.candidates).toEqual([
      'https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md',
    ]);
    expect(resolveSource('https://github.com/a/b/blob/dev/x/SKILL.md').candidates[0]).toBe(
      'https://raw.githubusercontent.com/a/b/dev/x/SKILL.md',
    );
  });

  it.each([
    'https://evil.example/SKILL.md',
    'https://github.com.evil.example/a/b/tree/main/x',
    'https://raw.githubusercontent.com.evil.example/a/b/main/SKILL.md',
    'http://github.com/a/b/tree/main/x',
    'https://user:pw@github.com/a/b/tree/main/x',
    'https://github.com:8443/a/b/tree/main/x',
    'ftp://github.com/a/b',
    'file:///etc/passwd',
  ])('domain/skema tidak diizinkan ditolak: %s', (input) => {
    expect(() => resolveSource(input)).toThrow(/tidak diizinkan|harus|tidak valid/i);
  });

  it('jalur berbahaya dan bentuk salah ditolak', () => {
    expect(() => resolveSource('https://github.com/a/b/tree/main/../../etc')).toThrow();
    expect(() => resolveSource('https://github.com/a/b')).toThrow();
    expect(() => resolveSource('')).toThrow();
    expect(() => resolveSource('x'.repeat(501))).toThrow();
  });
});

describe('fetchSkillText: batas dan keamanan unduhan', () => {
  const URL_OK = 'https://raw.githubusercontent.com/a/b/main/x/SKILL.md';

  it('mengunduh teks biasa', async () => {
    const { impl } = fake({ [URL_OK]: () => reply('halo') });
    expect(await fetchSkillText(URL_OK, impl)).toMatchObject({ status: 'ok', text: 'halo' });
  });

  it('404 = missing; status lain = 502', async () => {
    expect(await fetchSkillText(URL_OK, fake({}).impl)).toEqual({ status: 'missing' });
    const boom = fake({ [URL_OK]: () => new Response('', { status: 500 }) });
    await expect(fetchSkillText(URL_OK, boom.impl)).rejects.toMatchObject({ status: 502 });
  });

  it('melebihi 64 KB ditolak (lewat content-length maupun saat streaming)', async () => {
    const big = 'a'.repeat(MAX_SKILL_MD_BYTES + 1);
    const viaStream = fake({ [URL_OK]: () => reply(big) });
    await expect(fetchSkillText(URL_OK, viaStream.impl)).rejects.toMatchObject({
      code: 'skill_too_large',
    });
    const viaHeader = fake({
      [URL_OK]: () =>
        reply('kecil', {
          headers: { 'content-type': 'text/plain', 'content-length': String(big.length) },
        }),
    });
    await expect(fetchSkillText(URL_OK, viaHeader.impl)).rejects.toMatchObject({
      code: 'skill_too_large',
    });
    const exact = fake({ [URL_OK]: () => reply('a'.repeat(MAX_SKILL_MD_BYTES)) });
    expect((await fetchSkillText(URL_OK, exact.impl)).status).toBe('ok');
  });

  it('berkas biner dan jenis konten non-teks ditolak', async () => {
    const nul = fake({ [URL_OK]: () => reply(new Uint8Array([104, 0, 105])) });
    await expect(fetchSkillText(URL_OK, nul.impl)).rejects.toMatchObject({
      code: 'skill_not_text',
    });
    const bad = fake({ [URL_OK]: () => reply(new Uint8Array([0xff, 0xfe, 0xfd])) });
    await expect(fetchSkillText(URL_OK, bad.impl)).rejects.toMatchObject({
      code: 'skill_not_text',
    });
    const zip = fake({
      [URL_OK]: () => reply('PK', { headers: { 'content-type': 'application/zip' } }),
    });
    await expect(fetchSkillText(URL_OK, zip.impl)).rejects.toMatchObject({
      code: 'skill_not_text',
    });
  });

  it('pengalihan di dalam domain diikuti, keluar domain ditolak dan TIDAK diminta', async () => {
    const hop = 'https://raw.githubusercontent.com/a/b/main/y/SKILL.md';
    const ok = fake({
      [URL_OK]: () => new Response('', { status: 302, headers: { location: hop } }),
      [hop]: () => reply('dialihkan'),
    });
    expect(await fetchSkillText(URL_OK, ok.impl)).toMatchObject({ text: 'dialihkan' });

    const evil = fake({
      [URL_OK]: () =>
        new Response('', { status: 302, headers: { location: 'https://evil.example/steal' } }),
      'https://evil.example/steal': () => reply('jangan'),
    });
    await expect(fetchSkillText(URL_OK, evil.impl)).rejects.toMatchObject({
      code: 'skill_domain_not_allowed',
    });
    expect(evil.seen).toEqual([URL_OK]);
  });

  it('pengalihan tanpa akhir dihentikan', async () => {
    const loop = fake({
      [URL_OK]: () => new Response('', { status: 302, headers: { location: URL_OK } }),
    });
    await expect(fetchSkillText(URL_OK, loop.impl)).rejects.toMatchObject({ status: 502 });
    expect(loop.seen.length).toBeLessThanOrEqual(4);
  });

  it('URL di luar daftar izin tidak pernah diminta', async () => {
    const f = fake({});
    await expect(fetchSkillText('https://evil.example/x', f.impl)).rejects.toMatchObject({
      code: 'skill_domain_not_allowed',
    });
    expect(f.seen).toEqual([]);
  });
});

describe('parseSkillMd', () => {
  it('membaca name, description, isi', () => {
    expect(parseSkillMd(md('## Langkah\n1. a'))).toMatchObject({
      name: 'naskah-anak',
      description: 'Saat menulis naskah anak.',
      body: '## Langkah\n1. a\n',
      descriptionTrimmed: false,
    });
  });

  it('deskripsi berkutip dan blok lipat (>) didukung', () => {
    const quoted = '---\nname: "x y"\ndescription: "Saat A: pakai B."\n---\nisi';
    expect(parseSkillMd(quoted)).toMatchObject({ name: 'x y', description: 'Saat A: pakai B.' });
    const folded = '---\nname: x\ndescription: >\n  Saat menulis\n  naskah anak.\n---\nisi';
    expect(parseSkillMd(folded).description).toBe('Saat menulis naskah anak.');
  });

  it('deskripsi >200 karakter dipotong dan ditandai', () => {
    const long = `---\nname: x\ndescription: ${'kata '.repeat(80)}\n---\nisi`;
    const parsed = parseSkillMd(long);
    expect(parsed.descriptionTrimmed).toBe(true);
    expect(parsed.description.length).toBeLessThanOrEqual(200);
  });

  it.each([
    ['tanpa frontmatter', 'hanya isi'],
    ['tanpa name', '---\ndescription: a\n---\nisi'],
    ['tanpa description', '---\nname: a\n---\nisi'],
    ['tanpa isi', '---\nname: a\ndescription: b\n---\n   \n'],
  ])('menolak %s', (_label, text) => {
    expect(() => parseSkillMd(text)).toThrow();
  });
});

describe('fetchSkill', () => {
  it('mencoba kandidat berurutan sampai ketemu dan memberi checksum', async () => {
    const found = 'https://raw.githubusercontent.com/o/r/main/naskah/SKILL.md';
    const f = fake({ [found]: () => reply(md('Pakai `scripts/run.sh` untuk render.')) });
    const skill = await fetchSkill(resolveSource('o/r@naskah'), f.impl);
    expect(skill.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(skill.mentionsScripts).toBe(true);
    expect(f.seen[0]).toContain('/skills/naskah/SKILL.md');
    expect(f.seen).toContain(found);
  });

  it('tidak ada di semua kandidat: 404 skill_source_not_found', async () => {
    await expect(fetchSkill(resolveSource('o/r@hantu'), fake({}).impl)).rejects.toMatchObject({
      status: 404,
      code: 'skill_source_not_found',
    });
  });

  it('mentionsScripts', () => {
    expect(mentionsScripts('jalankan scripts/build.sh')).toBe(true);
    expect(mentionsScripts('lihat ./install.ps1')).toBe(true);
    expect(mentionsScripts('tulis kalimat pendek')).toBe(false);
  });
});
