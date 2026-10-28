import { INITIAL_ROLE_IDS, RoleIdSchema } from '@aios/contracts';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AGENT_BEHAVIOR_RULES,
  BUNDLE_TOKEN_BUDGET,
  CORE_SKILLS,
  ROLES_PACKAGE_DIR,
  RegistryError,
  SKILL_PACKS,
  SKILLS_TOKEN_BUDGET,
  UnknownRoleError,
  buildBundle,
  estimateTokens,
  loadRegistry,
  splitFrontmatter,
} from './index.js';

const registry = loadRegistry();

/** Agent di ROLES_AND_SKILLS.md: grup, mesin, dan skill milik agent itu sendiri (di luar skill inti). */
const SPEC: Record<string, { group: string; engine: string; skills: string[] }> = {
  general: { group: 'umum', engine: 'hermes', skills: ['answer-first', 'clarify-once'] },
  project: { group: 'coding', engine: 'omp', skills: [] },
  researcher: {
    group: 'umum',
    engine: 'research',
    skills: ['source-verification', 'citation', 'fact-vs-opinion'],
  },
};

describe('isi agent dan skill di repo', () => {
  it('memuat tepat agent yang ditetapkan', () => {
    expect([...registry.roles.keys()].sort()).toEqual([...INITIAL_ROLE_IDS].sort());
    expect(Object.keys(SPEC).sort()).toEqual([...INITIAL_ROLE_IDS].sort());
  });

  it.each(Object.entries(SPEC))(
    'agent %s: frontmatter lengkap dan sesuai tabel dokumen',
    (id, spec) => {
      const role = registry.roles.get(id)!;
      expect(RoleIdSchema.safeParse(role.id).success).toBe(true);
      expect([role.group, role.engine]).toEqual([spec.group, spec.engine]);
      expect(role.name).not.toBe('');
      expect(role.model).not.toBe('');
      expect(role.fallbackModel).not.toBeNull();
      expect(role.skills.filter((s) => (CORE_SKILLS as readonly string[]).includes(s))).toEqual([
        ...CORE_SKILLS,
      ]);
      expect(role.skills.filter((s) => !(CORE_SKILLS as readonly string[]).includes(s))).toEqual(
        spec.skills,
      );
    },
  );

  it('isi agent memuat bagian Peran, Cara kerja, Definition of done, dan Format output', () => {
    for (const role of registry.roles.values()) {
      for (const heading of [
        '# Peran',
        '# Cara kerja',
        '# Definition of done',
        '# Format output',
      ]) {
        expect(role.body, `${role.id}: ${heading}`).toContain(heading);
      }
    }
  });

  it('agent project bertanya sebelum mengubah (approval ask)', () => {
    expect(registry.roles.get('project')!.approval).toBe('ask');
  });

  it('setiap skill dimuat oleh inti, agent, atau paket skill; tidak ada yang yatim', () => {
    const referenced = new Set<string>(CORE_SKILLS);
    for (const spec of Object.values(SPEC)) for (const s of spec.skills) referenced.add(s);
    for (const pack of SKILL_PACKS) for (const s of pack.skills) referenced.add(s);
    expect([...registry.skills.keys()].sort()).toEqual([...referenced].sort());
    for (const skill of registry.skills.values()) {
      expect(skill.description.length, skill.id).toBeGreaterThan(10);
      expect(estimateTokens(skill.body), `${skill.id} terlalu panjang`).toBeLessThanOrEqual(450);
      const bullets = skill.body.split('\n').filter((l) => l.startsWith('- '));
      expect(bullets.length, `${skill.id} butuh butir checklist`).toBeGreaterThanOrEqual(4);
    }
  });

  it('ui-baseline memuat larangan anti AI slop dari DESIGN_SYSTEM.md', () => {
    const body = registry.skills.get('ui-baseline')!.body.toLowerCase();
    for (const phrase of [
      'gradien',
      'glassmorphism',
      'skeleton',
      'ibm plex',
      'satu tombol primer',
    ]) {
      expect(body, phrase).toContain(phrase);
    }
  });
});

describe('bundel system prompt', () => {
  it.each([...registry.roles.keys()])('agent %s: di bawah anggaran dan semua bagian ada', (id) => {
    const bundle = buildBundle(registry, id);
    const role = registry.roles.get(id)!;

    expect(bundle.omittedSkills).toEqual([]);
    expect(bundle.overBudget).toBe(false);
    expect(bundle.tokens.skills).toBeLessThanOrEqual(SKILLS_TOKEN_BUDGET);
    expect(bundle.tokens.total).toBeLessThanOrEqual(BUNDLE_TOKEN_BUDGET);
    expect(bundle.tokens.total).toBe(estimateTokens(bundle.systemPrompt));

    for (const rule of AGENT_BEHAVIOR_RULES) expect(bundle.systemPrompt).toContain(rule);
    expect(bundle.systemPrompt).toContain(role.body);
    expect(bundle.skills).toEqual([
      ...CORE_SKILLS,
      ...role.skills.filter((s) => !(CORE_SKILLS as readonly string[]).includes(s)),
    ]);
    for (const skill of bundle.skills) {
      expect(bundle.systemPrompt).toContain(registry.skills.get(skill)!.body);
    }
    const at = (text: string) => bundle.systemPrompt.indexOf(text);
    expect(at('# Aturan perilaku agent')).toBe(0);
    expect(at('# Aturan perilaku agent')).toBeLessThan(at(`# Peran: ${role.name}`));
    expect(at(`# Peran: ${role.name}`)).toBeLessThan(at('# Skill inti'));
  });

  it('skill spesialis hanya masuk bila diminta lewat extraSkills, tanpa dobel', () => {
    const plain = buildBundle(registry, 'project').systemPrompt;
    expect(plain).not.toContain(registry.skills.get('ui-baseline')!.body);

    const withUi = buildBundle(registry, 'project', {
      extraSkills: ['ui-baseline', 'a11y-check', 'ui-baseline', 'skill-hantu'],
    });
    expect(withUi.skills).toEqual([...CORE_SKILLS, 'ui-baseline', 'a11y-check']);
    expect(withUi.systemPrompt).toContain(registry.skills.get('ui-baseline')!.body);
    expect(withUi.systemPrompt.match(/## ui-baseline/g)).toHaveLength(1);
  });

  it('semua paket skill sekaligus tetap di bawah anggaran bundel', () => {
    const extraSkills = SKILL_PACKS.flatMap((p) => p.skills);
    const bundle = buildBundle(registry, 'project', { extraSkills });
    // Bila tidak muat, yang dilewati utuh dan dilaporkan; bundel tidak boleh melebihi anggaran.
    expect(bundle.tokens.skills).toBeLessThanOrEqual(SKILLS_TOKEN_BUDGET);
  });

  it('anggaran sempit: skill inti tetap masuk, skill khusus yang tidak muat dilewati utuh', () => {
    const extraSkills = ['ui-baseline', 'a11y-check', 'ui-states', 'react-practices'];
    const tight = buildBundle(registry, 'project', { skillsBudget: 900, extraSkills });
    expect(tight.skills.slice(0, 5)).toEqual([...CORE_SKILLS]);
    expect(tight.omittedSkills.length).toBeGreaterThan(0);
    for (const id of tight.omittedSkills) {
      expect(tight.systemPrompt).not.toContain(`## ${id}\n`);
    }
    expect(tight.tokens.skills).toBeLessThanOrEqual(900);
    expect(tight.overBudget).toBe(false);
    const tiny = buildBundle(registry, 'project', { skillsBudget: 100, extraSkills });
    expect(tiny.skills).toEqual([...CORE_SKILLS]);
    expect(tiny.overBudget).toBe(true);
  });

  it('agent yang tidak ada: UnknownRoleError', () => {
    expect(() => buildBundle(registry, 'tukang-sulap')).toThrow(UnknownRoleError);
  });
});

describe('validasi saat memuat', () => {
  const dirs: string[] = [];
  /** Salinan isi repo yang boleh dirusak. */
  const sandbox = () => {
    const dir = mkdtempSync(join(tmpdir(), 'aios-roles-'));
    dirs.push(dir);
    cpSync(join(ROLES_PACKAGE_DIR, 'roles'), join(dir, 'roles'), { recursive: true });
    cpSync(join(ROLES_PACKAGE_DIR, 'skills'), join(dir, 'skills'), { recursive: true });
    return dir;
  };
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const edit = (file: string, fn: (text: string) => string) =>
    writeFileSync(file, fn(readFileSync(file, 'utf8')));
  const problemsOf = (dir: string) => {
    try {
      loadRegistry(dir);
    } catch (err) {
      if (err instanceof RegistryError) return err.problems;
      throw err;
    }
    throw new Error('seharusnya gagal');
  };

  it('salinan utuh lolos (sandbox sehat)', () => {
    expect(loadRegistry(sandbox()).roles.size).toBe(INITIAL_ROLE_IDS.length);
  });

  it('agent merujuk skill yang tidak ada: gagal dengan menyebut file dan skill-nya', () => {
    const dir = sandbox();
    edit(join(dir, 'roles', 'general.md'), (t) => t.replace('clarify-once', 'skill-hantu'));
    expect(problemsOf(dir)).toEqual([
      'roles/general.md: merujuk skill "skill-hantu" yang tidak ada',
    ]);
  });

  it('id tidak sama dengan nama file dan field asing: semua dilaporkan sekaligus', () => {
    const dir = sandbox();
    edit(join(dir, 'roles', 'researcher.md'), (t) => t.replace('id: researcher', 'id: peneliti'));
    edit(join(dir, 'roles', 'project.md'), (t) =>
      t.replace('approval: ask', 'approval: ask\nwarna: merah'),
    );
    const problems = problemsOf(dir).join('\n');
    expect(problems).toContain('roles/researcher.md: id "peneliti" harus sama dengan nama file');
    expect(problems).toMatch(/roles\/project\.md: .*warna/);
  });

  it('enum salah, YAML rusak, frontmatter hilang, dan isi kosong', () => {
    const dir = sandbox();
    edit(join(dir, 'roles', 'general.md'), (t) => t.replace('engine: hermes', 'engine: gpt'));
    edit(join(dir, 'roles', 'project.md'), (t) => t.replace('name: Project', 'name: [Project'));
    writeFileSync(join(dir, 'roles', 'baru.md'), '# tanpa frontmatter\n');
    edit(
      join(dir, 'skills', 'citation', 'SKILL.md'),
      (t) => t.split('---\n').slice(0, 2).join('---\n') + '---\n',
    );
    const problems = problemsOf(dir);
    expect(problems.some((p) => p.startsWith('roles/general.md: engine'))).toBe(true);
    expect(problems.some((p) => p.startsWith('roles/project.md: YAML tidak valid'))).toBe(true);
    expect(problems).toContain(
      'roles/baru.md: frontmatter (--- ... ---) tidak ditemukan di awal file',
    );
    expect(problems).toContain('skills/citation/SKILL.md: isi skill kosong');
  });

  it('skill inti hilang dan nama skill tidak sama dengan folder', () => {
    const dir = sandbox();
    rmSync(join(dir, 'skills', 'scope-guard'), { recursive: true });
    edit(join(dir, 'skills', 'stop-slop', 'SKILL.md'), (t) =>
      t.replace('name: stop-slop', 'name: stop-sloppy'),
    );
    const problems = problemsOf(dir);
    expect(problems).toContain('skill inti "scope-guard" tidak ada');
    expect(problems).toContain(
      'skills/stop-slop/SKILL.md: name "stop-sloppy" harus sama dengan nama folder',
    );
    // Agent yang merujuk skill inti yang hilang ikut dilaporkan.
    expect(problems.filter((p) => p.includes('"scope-guard" yang tidak ada')).length).toBe(
      INITIAL_ROLE_IDS.length,
    );
  });

  it('agent umum dan project wajib ada', () => {
    const dir = sandbox();
    rmSync(join(dir, 'roles', 'project.md'));
    expect(problemsOf(dir)).toContain('agent "project" wajib ada');
  });

  it('skill tanpa SKILL.md, folder kosong, dan skill dobel di frontmatter agent', () => {
    const dir = sandbox();
    mkdirSync(join(dir, 'skills', 'kosong'));
    edit(join(dir, 'roles', 'general.md'), (t) => t.replace('clarify-once', 'answer-first'));
    const problems = problemsOf(dir);
    expect(problems).toContain('skills/kosong/SKILL.md: file tidak ada');
    expect(
      problems.some((p) => p.includes('roles/general.md: skills') && p.includes('dobel')),
    ).toBe(true);
  });

  it('folder tidak ada sama sekali: gagal, bukan registri kosong', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aios-roles-kosong-'));
    dirs.push(dir);
    expect(problemsOf(dir)).toEqual(
      expect.arrayContaining(['folder skills/ tidak ada', 'folder roles/ tidak ada']),
    );
  });

  it('splitFrontmatter menerima CRLF dan BOM', () => {
    const text = '﻿---\r\nname: x\r\n---\r\nisi\r\nbaris dua';
    expect(splitFrontmatter(text)).toEqual({ data: { name: 'x' }, body: 'isi\r\nbaris dua' });
  });
});
