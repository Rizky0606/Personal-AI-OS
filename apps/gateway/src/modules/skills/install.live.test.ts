import {
  SkillDetailSchema,
  SkillInstallPreviewSchema,
  SkillSaveResultSchema,
} from '@aios/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

/**
 * Pemasangan dari sumber NYATA (github.com, raw.githubusercontent.com, skills.sh) lewat `fetch` asli.
 * Butuh internet, jadi hanya jalan bila `AIOS_LIVE_NET=1` (tes lain memakai internet palsu).
 * Jalankan: AIOS_LIVE_NET=1 TEST_DATABASE_URL=... pnpm --filter @aios/gateway exec vitest run install.live
 */
const live = process.env.AIOS_LIVE_NET === '1';

const REPO = 'anthropics/skills';
const SKILL = 'skill-creator';
const SOURCES = {
  'id skills.sh': `${REPO}@${SKILL}`,
  'URL skills.sh': `https://skills.sh/${REPO}/${SKILL}`,
  'URL GitHub (folder)': `https://github.com/${REPO}/tree/main/skills/${SKILL}`,
  'URL raw': `https://raw.githubusercontent.com/${REPO}/main/skills/${SKILL}/SKILL.md`,
} as const;

let env: AuthEnv;
let app: string;
const preview = (source: string) => env.post('/skills/install/preview', { source }, app);

describe.skipIf(!live)('pasang skill dari sumber nyata', () => {
  beforeAll(async () => {
    env = await createAuthEnv(inject('testDatabaseUrl'), {
      skillInstall: { fetchImpl: (url, init) => fetch(url, init) },
    });
    app = (await env.loginOk({ kind: 'desktop' })).accessToken;
  });
  afterAll(async () => {
    await env.close();
  });

  const checksums = new Set<string>();
  for (const [label, source] of Object.entries(SOURCES)) {
    it(`pratinjau lewat ${label} menghasilkan skill yang sama`, async () => {
      const res = await preview(source);
      expect(res.statusCode, res.body).toBe(200);
      const p = SkillInstallPreviewSchema.parse(res.json());
      expect(p.candidate.id).toBe(SKILL);
      expect(p.candidate.body.length).toBeGreaterThan(500);
      expect(p.candidate.description.length).toBeLessThanOrEqual(200);
      expect(p.source.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
      checksums.add(p.candidate.checksum);
    }, 30_000);
  }

  it('keempat bentuk sumber memberi checksum identik', () => {
    expect(checksums.size).toBe(1);
  });

  it('pasang: tersimpan sebagai installed/community dengan checksum pratinjau, lalu pembaruan tanpa perubahan', async () => {
    const source = SOURCES['id skills.sh'];
    const p = SkillInstallPreviewSchema.parse((await preview(source)).json());
    expect(p.installable, JSON.stringify(p.scan)).toBe(true);

    const res = await env.post(
      '/skills/install',
      {
        source,
        checksum: p.candidate.checksum,
        ...(p.scan.verdict === 'warning' ? { acknowledge: true } : {}),
      },
      app,
    );
    expect(res.statusCode, res.body).toBe(201);
    const saved = SkillSaveResultSchema.parse(res.json());
    expect(saved).toMatchObject({
      id: SKILL,
      source: 'installed',
      trust: 'community',
      status: 'active',
    });
    expect(saved.checksum).toBe(p.candidate.checksum);

    const detail = SkillDetailSchema.parse((await env.get(`/skills/${SKILL}`, app)).json());
    expect(detail.body).toBe(p.candidate.body);
    expect(detail.origin).toBeTruthy();

    // Pratinjau kedua: kini pembaruan, dan isinya sama dengan yang terpasang.
    const again = SkillInstallPreviewSchema.parse((await preview(source)).json());
    expect(again.action).toBe('update');
    expect(again.existing?.body).toBe(p.candidate.body);
  }, 60_000);

  it('checksum yang kedaluwarsa ditolak 409 dan tidak mengubah apa pun', async () => {
    const res = await env.post(
      '/skills/install',
      { source: SOURCES['URL raw'], checksum: '0'.repeat(64), acknowledge: true },
      app,
    );
    expect(res.statusCode).toBe(409);
  }, 30_000);

  it('skill Vercel dengan description YAML bertingkat (dulu skill_source_invalid) kini terbaca', async () => {
    for (const source of [
      'vercel-labs/agent-skills@composition-patterns',
      'vercel-labs/agent-skills@react-native-skills',
    ]) {
      const res = await preview(source);
      expect(res.statusCode, `${source}: ${res.body}`).toBe(200);
      const p = SkillInstallPreviewSchema.parse(res.json());
      expect(p.candidate.description.length, source).toBeGreaterThan(20);
      expect(p.candidate.description.length, source).toBeLessThanOrEqual(200);
      expect(p.candidate.body.length, source).toBeGreaterThan(200);
    }
  }, 60_000);

  it('peringatan pemindai pada skill pihak ketiga nyata: ditolak tanpa persetujuan, terpasang dengan acknowledge', async (ctx) => {
    const source = 'vercel-labs/agent-skills@vercel-cli-with-tokens';
    const p = SkillInstallPreviewSchema.parse((await preview(source)).json());
    // Isi di sumber bisa berubah; tes ini hanya bermakna selama pemindai masih memberi peringatan.
    if (p.scan.verdict !== 'warning') ctx.skip();
    expect(p.installable).toBe(true);
    expect(p.scan.findings.length).toBeGreaterThan(0);

    const body = { source, checksum: p.candidate.checksum };
    const refused = await env.post('/skills/install', body, app);
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ code: string }>().code).toBe('skill_scan_confirm');

    const ok = await env.post('/skills/install', { ...body, acknowledge: true }, app);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(SkillSaveResultSchema.parse(ok.json())).toMatchObject({
      id: p.candidate.id,
      source: 'installed',
      trust: 'community',
    });
  }, 60_000);

  it('sumber yang tidak ada: 404; domain asing: 422', async () => {
    expect((await preview(`${REPO}@skill-yang-tidak-ada-xyz`)).statusCode).toBe(404);
    expect((await preview('https://example.com/SKILL.md')).statusCode).toBe(422);
  }, 60_000);
});
