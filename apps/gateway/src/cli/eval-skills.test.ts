import { loadRegistry, buildBundle, selectSkills, CORE_SKILLS } from '@aios/roles';
import { describe, expect, it } from 'vitest';
import { SKILL_EVAL_CASES } from './eval-skills.data.js';

const registry = loadRegistry();
const known = new Set(registry.skills.keys());

describe('set evaluasi pemilihan skill (offline, memastikan data uji sendiri valid)', () => {
  it('20 pesan dengan lima kelompok: umum, coding, riset, menulis, video', () => {
    expect(SKILL_EVAL_CASES).toHaveLength(20);
    expect(new Set(SKILL_EVAL_CASES.map((c) => c.group))).toEqual(
      new Set(['umum', 'coding', 'riset', 'menulis', 'video']),
    );
    expect(new Set(SKILL_EVAL_CASES.map((c) => c.message)).size).toBe(20);
  });

  it('semua skill yang diharapkan ada di katalog', () => {
    for (const c of SKILL_EVAL_CASES) {
      for (const id of c.expectAny) expect(known.has(id), `${id} untuk "${c.message}"`).toBe(true);
    }
  });

  it('skill yang diharapkan benar-benar DITAWARKAN di indeks untuk pesan itu (kalau tidak, agent mustahil memilihnya)', () => {
    for (const c of SKILL_EVAL_CASES) {
      if (c.expectAny.length === 0) continue;
      const { skills } = selectSkills(c.message, { agent: c.agent, known });
      const bundle = buildBundle(registry, c.agent, { suggestedSkills: skills });
      const reachable = new Set([...bundle.offeredSkills, ...bundle.skills]);
      expect(
        c.expectAny.some((id) => reachable.has(id)),
        `"${c.message}" tidak menawarkan ${c.expectAny.join('/')}; ditawarkan: ${[...reachable].join(', ')}`,
      ).toBe(true);
    }
  });

  it('pesan tanpa skill khusus tidak memicu paket kata kunci (indeks kosong, hanya skill inti)', () => {
    for (const c of SKILL_EVAL_CASES.filter((x) => x.expectAny.length === 0)) {
      const { skills } = selectSkills(c.message, { agent: c.agent, known });
      expect(skills, c.message).toEqual([]);
      const bundle = buildBundle(registry, c.agent, { suggestedSkills: skills });
      expect(bundle.offeredSkills).toEqual([]);
      for (const core of CORE_SKILLS) expect(bundle.skills).toContain(core);
    }
  });
});
