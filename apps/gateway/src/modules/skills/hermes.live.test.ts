import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { HermesSkillListSchema, SkillSaveResultSchema } from '@aios/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';

/**
 * Skill Hermes dari folder NYATA (`AIOS_LIVE_HERMES_DIR`, mis. ~/.hermes/skills). Hanya baca: tes memastikan
 * folder tidak berubah. Opt-in, tidak jalan bila variabelnya kosong.
 * Jalankan: AIOS_LIVE_HERMES_DIR=$HOME/.hermes/skills TEST_DATABASE_URL=... pnpm --filter @aios/gateway exec vitest run hermes.live
 */
const root = process.env.AIOS_LIVE_HERMES_DIR;
const trace = process.env.AIOS_LIVE_TRACE;
const note = (line: string) => {
  if (trace) appendFileSync(trace, `${line}\n`);
};

/** Sidik jari folder: jumlah berkas + ukuran + mtime, supaya perubahan sekecil apa pun terdeteksi. */
const fingerprint = (dir: string) =>
  execFileSync('bash', ['-c', `find "${dir}" -type f -printf '%p %s %T@\\n' | sort | sha256sum`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

let env: AuthEnv;
let app: string;

describe.skipIf(!root)('skill Hermes dari folder nyata', () => {
  let before = '';
  beforeAll(async () => {
    before = fingerprint(root!);
    env = await createAuthEnv(inject('testDatabaseUrl'), { skillInstall: { hermesRoot: root! } });
    app = (await env.loginOk({ kind: 'desktop' })).accessToken;
  });
  afterAll(async () => {
    await env.close();
  });

  it('daftar dibaca dari folder, tanpa skill aios-, dan memuat semua skill di folder', async () => {
    const res = await env.get('/skills/hermes', app);
    expect(res.statusCode, res.body).toBe(200);
    const list = HermesSkillListSchema.parse(res.json());
    const onDisk = Number(
      execFileSync(
        'bash',
        ['-c', `find "${root}" -name SKILL.md -not -path "${root}/aios/*" -not -type l | wc -l`],
        { encoding: 'utf8' },
      ),
    );
    note(`LIST via=${list.via} listed=${list.items.length} onDisk=${onDisk}`);
    expect(list.via).toBe('folder');
    expect(list.items.some((i) => i.name.startsWith('aios-'))).toBe(false);
    // Folder boleh punya nama ganda atau SKILL.md tak terurai, tapi tidak boleh terpotong diam-diam.
    expect(list.items.length).toBeGreaterThan(0);
    expect(onDisk - list.items.length).toBeLessThanOrEqual(Math.ceil(onDisk * 0.1));
  });

  it('impor satu skill nyata: tersimpan installed, bisa dipakai agent, folder Hermes tidak berubah', async () => {
    const list = HermesSkillListSchema.parse((await env.get('/skills/hermes', app)).json());
    const target = list.items.find((i) => i.importable && !i.imported);
    expect(target, 'harus ada skill yang bisa diimpor').toBeTruthy();
    let res = await env.post('/skills/hermes/import', { name: target!.name }, app);
    if (res.statusCode === 422 || res.statusCode === 409) {
      note(`IMPORT ${target!.name} -> ${res.statusCode} ${res.json<{ code: string }>().code}`);
      res = await env.post('/skills/hermes/import', { name: target!.name, acknowledge: true }, app);
    }
    note(`IMPORT ${target!.name} -> ${res.statusCode}`);
    expect(res.statusCode, res.body).toBe(201);
    const saved = SkillSaveResultSchema.parse(res.json());
    expect(saved.source).toBe('installed');
    expect(saved.status).toBe('active');
    const after = HermesSkillListSchema.parse((await env.get('/skills/hermes', app)).json());
    expect(after.items.find((i) => i.name === target!.name)?.imported).toBe(true);
  });

  it('mengimpor semua skill yang bisa dibaca: tidak ada yang 5xx; hasilnya dihitung', async () => {
    const list = HermesSkillListSchema.parse((await env.get('/skills/hermes', app)).json());
    const tally: Record<string, number> = {};
    for (const item of list.items.filter((i) => i.importable && !i.imported)) {
      const res = await env.post('/skills/hermes/import', { name: item.name }, app);
      const key =
        res.statusCode === 201 ? '201' : `${res.statusCode} ${res.json<{ code?: string }>().code}`;
      tally[key] = (tally[key] ?? 0) + 1;
      expect(res.statusCode, `${item.name}: ${res.body}`).toBeLessThan(500);
    }
    note(`TALLY ${JSON.stringify(tally)}`);
  }, 300_000);

  it('folder Hermes tidak berubah sama sekali (tanpa tulis, tanpa hapus)', () => {
    expect(fingerprint(root!)).toBe(before);
  });
});
