/**
 * Menyalin katalog skill ke folder skill Hermes sebagai `aios/<id>/SKILL.md` (nama `aios-<id>`). Langkah ini
 * SENGAJA eksplisit, tidak berjalan otomatis saat gateway start; jalankan setelah skill berubah:
 *
 *   pnpm skills:sync-hermes                # tulis
 *   pnpm skills:sync-hermes --dry-run      # hanya laporkan rencana
 *   pnpm skills:sync-hermes --verify       # setelah menulis, cek GET /v1/skills di Hermes
 *
 * Env: HERMES_SKILLS_DIR (bawaan ~/.hermes/skills), HERMES_URL, HERMES_API_KEY (untuk --verify).
 * Hanya `<HERMES_SKILLS_DIR>/aios/` yang ditulis; folder lain milik Hermes tidak disentuh.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry } from '@aios/roles';
import { createDb } from '../db/client.js';
import { createSkillManager } from '../modules/skills/manager.js';
import { createSkillsService } from '../modules/skills/service.js';
import {
  hermesSkillsFor,
  syncHermesSkills,
  HERMES_SKILL_PREFIX,
} from '../modules/skills/hermes-sync.js';

const args = new Set(process.argv.slice(2));
const root = process.env.HERMES_SKILLS_DIR ?? join(homedir(), '.hermes', 'skills');

// Dengan DATABASE_URL, skill tambahan (P10) ikut disalin. Tanpa itu hanya skill bawaan yang diketahui, jadi
// folder aios/ TIDAK dipangkas: skill tambahan yang sudah ada di sana jangan sampai terhapus.
const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl ? createDb(databaseUrl) : undefined;
const manager = connection
  ? createSkillManager({ db: connection.db, registry: () => loadRegistry() })
  : undefined;
await manager?.load();
const catalog = createSkillsService({
  registry: () => loadRegistry(),
  extras: () => manager?.extras() ?? [],
  overrides: () => manager?.overrides() ?? new Map(),
});
const skills = hermesSkillsFor(catalog);

const result = await syncHermesSkills(skills, {
  root,
  dryRun: args.has('--dry-run'),
  prune: connection !== undefined,
});
if (!connection)
  console.log('Tanpa DATABASE_URL: hanya skill bawaan disalin, tidak ada yang dihapus dari aios/.');
await connection?.close();
console.log(
  `${args.has('--dry-run') ? '[dry-run] ' : ''}${root}/aios: ` +
    `${result.written.length} ditulis, ${result.unchanged.length} sama, ${result.removed.length} dihapus, ` +
    `${result.skipped.length} dilewati`,
);
if (result.skipped.length > 0)
  console.log(`dilewati (bukan buatan aios): ${result.skipped.join(', ')}`);

if (args.has('--verify')) {
  const url = (process.env.HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/$/, '');
  const key = process.env.HERMES_API_KEY;
  const response = await fetch(`${url}/v1/skills`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    console.error(`GET /v1/skills gagal: HTTP ${response.status}`);
    process.exit(1);
  }
  const seen = new Set(
    [
      ...JSON.stringify(await response.json()).matchAll(
        new RegExp(`${HERMES_SKILL_PREFIX}[a-z0-9-]+`, 'g'),
      ),
    ].map((m) => m[0]),
  );
  const expected = skills.map((s) => `${HERMES_SKILL_PREFIX}${s.id}`);
  const missing = expected.filter((name) => !seen.has(name));
  console.log(
    `Hermes /v1/skills: ${expected.length - missing.length}/${expected.length} skill aios- terlihat`,
  );
  if (missing.length > 0 && !args.has('--dry-run')) {
    console.error(`belum terlihat: ${missing.join(', ')}`);
    process.exit(1);
  }
}
