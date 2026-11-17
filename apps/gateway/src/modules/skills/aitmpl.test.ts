import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors.js';
import {
  MAX_SKILL_MD_BYTES,
  checksumOfBody,
  fetchSkill,
  resolveSource,
  type FetchLike,
} from './installer.js';

const PAGE = 'https://www.aitmpl.com/component/skills/creative-design/algorithmic-art';
const JSON_URL =
  'https://www.aitmpl.com/component-content/skills/creative-design/algorithmic-art.json';

const md = (body = 'Isi skill.') =>
  `---\nname: algorithmic-art\ndescription: Seni algoritmik dari kode.\nlicense: Lihat LICENSE.txt\n---\n${body}\n`;

/** Bentuk balasan nyata `component-content`: `{ content, meta }`. */
const envelope = (content: string) =>
  JSON.stringify({
    content,
    meta: { files: [{ path: 'SKILL.md', bytes: content.length, lines: 1 }], languages: [] },
  });

const json = (text: string) =>
  new Response(new Blob([text]), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

/** fetch palsu berbasis peta URL -> Response. */
const fake = (routes: Record<string, () => Response>): FetchLike => {
  return (url) => Promise.resolve(routes[url]?.() ?? new Response('', { status: 404 }));
};

/** Memastikan `fn` melempar AppError dengan status dan code yang diminta. */
const expectSyncCode = (fn: () => unknown, status: number, code: string) => {
  let err: unknown = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AppError);
  expect(err).toMatchObject({ status, code });
};

const expectAsyncCode = async (promise: Promise<unknown>, status: number, code: string) => {
  let err: unknown = null;
  try {
    await promise;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AppError);
  expect(err).toMatchObject({ status, code });
};

describe('aitmpl: resolusi sumber', () => {
  it('id kategori/nama, id katalog skills/…, dan kedua bentuk URL menuju komponen kanonis yang sama', () => {
    for (const source of [
      'creative-design/algorithmic-art',
      'skills/creative-design/algorithmic-art',
      PAGE,
      `${PAGE}/`,
      JSON_URL,
    ]) {
      const r = resolveSource(source);
      expect(r.kind, source).toBe('aitmpl');
      expect(r.input, source).toBe(PAGE);
      expect(r.candidates, source).toEqual([JSON_URL]);
    }
  });

  it.each([
    'agents/development-tools/code-reviewer',
    'commands/analysis/supply-chain-audit',
    'hooks/git/conventional-commits',
    'mcps/audio/elevenlabs',
    'mcp/audio/elevenlabs',
    'settings/api/bedrock-configuration',
    'loops/engineering/adversarial-review-loop',
    'mods/enterprise/admin-capability-lockdown',
    'hooks/git',
    'https://www.aitmpl.com/component/mcps/audio/elevenlabs',
    'https://www.aitmpl.com/component-content/hooks/automation/agents-md-loader.json',
  ])('tipe bukan skills ditolak 422 sebelum unduhan: %s', (source) => {
    expectSyncCode(() => resolveSource(source), 422, 'skill_type_not_importable');
  });

  it('domain mirip tetapi bukan www.aitmpl.com ditolak', () => {
    expectSyncCode(
      () => resolveSource('https://aitmpl.com/component/skills/creative-design/algorithmic-art'),
      422,
      'skill_domain_not_allowed',
    );
  });

  it('URL aitmpl yang bukan halaman komponen ditolak 422 skill_source_invalid', () => {
    expectSyncCode(
      () => resolveSource('https://www.aitmpl.com/skills'),
      422,
      'skill_source_invalid',
    );
  });
});

describe('aitmpl: unduhan dan bentuk JSON', () => {
  it('mengambil SKILL.md dari `content`, checksum sama dengan isi body', async () => {
    const f = await fetchSkill(
      resolveSource('creative-design/algorithmic-art'),
      fake({ [JSON_URL]: () => json(envelope(md('Langkah satu.'))) }),
    );
    expect(f.name).toBe('algorithmic-art');
    expect(f.body).toContain('Langkah satu.');
    expect(f.url).toBe(JSON_URL);
    expect(f.checksum).toBe(checksumOfBody(f.body));
  });

  it.each(['<html>tidak</html>', '{"foo":1}', '{"content":5}'])(
    'balasan tidak sesuai bentuk ditolak 422 skill_source_invalid: %s',
    async (text) => {
      await expectAsyncCode(
        fetchSkill(
          resolveSource('creative-design/algorithmic-art'),
          fake({ [JSON_URL]: () => json(text) }),
        ),
        422,
        'skill_source_invalid',
      );
    },
  );

  it('`content` tanpa frontmatter SKILL.md ditolak 422 skill_source_invalid', async () => {
    await expectAsyncCode(
      fetchSkill(
        resolveSource('creative-design/algorithmic-art'),
        fake({ [JSON_URL]: () => json(envelope('tanpa frontmatter sama sekali')) }),
      ),
      422,
      'skill_source_invalid',
    );
  });

  it('`content` yang mengandung NUL ditolak 422 skill_not_text', async () => {
    await expectAsyncCode(
      fetchSkill(
        resolveSource('creative-design/algorithmic-art'),
        fake({ [JSON_URL]: () => json(envelope(md('a\u0000b'))) }),
      ),
      422,
      'skill_not_text',
    );
  });

  it('isi melebihi batas SKILL.md ditolak 422 skill_too_large', async () => {
    await expectAsyncCode(
      fetchSkill(
        resolveSource('creative-design/algorithmic-art'),
        fake({ [JSON_URL]: () => json(envelope(md('x'.repeat(MAX_SKILL_MD_BYTES)))) }),
      ),
      422,
      'skill_too_large',
    );
  });

  it('pengalihan ke domain di luar allowlist ditolak 422 skill_domain_not_allowed', async () => {
    for (const location of ['https://evil.example/x.json', 'https://aitmpl.com/x.json']) {
      await expectAsyncCode(
        fetchSkill(
          resolveSource('creative-design/algorithmic-art'),
          fake({ [JSON_URL]: () => redirect(location) }),
        ),
        422,
        'skill_domain_not_allowed',
      );
    }
  });

  it('pengalihan yang tetap di www.aitmpl.com diikuti', async () => {
    const alt =
      'https://www.aitmpl.com/component-content/skills/creative-design/algorithmic-art-2.json';
    const f = await fetchSkill(
      resolveSource('creative-design/algorithmic-art'),
      fake({ [JSON_URL]: () => redirect(alt), [alt]: () => json(envelope(md())) }),
    );
    expect(f.url).toBe(alt);
  });
});
