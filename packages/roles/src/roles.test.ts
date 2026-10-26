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
  SKILLS_TOKEN_BUDGET,
  UnknownRoleError,
  buildBundle,
  estimateTokens,
  loadRegistry,
  splitFrontmatter,
} from './index.js';

const registry = loadRegistry();

/** Tabel "Role awal (7)" di ROLES_AND_SKILLS.md: grup, mesin, dan skill khusus. */
const SPEC: Record<string, { group: string; engine: string; skills: string[] }> = {
  general: { group: 'umum', engine: 'hermes', skills: ['answer-first', 'clarify-once'] },
  researcher: {
    group: 'umum',
    engine: 'research',
    skills: ['source-verification', 'citation', 'fact-vs-opinion'],
  },
  writer: {
    group: 'umum',
    engine: 'hermes',
    skills: ['stop-slop', 'script-structure', 'audience-voice'],
  },
  frontend: {
    group: 'coding',
    engine: 'omp',
    skills: ['ui-baseline', 'a11y-check', 'ui-states', 'react-practices'],
  },
  backend: {
    group: 'coding',
    engine: 'omp',
    skills: ['api-design', 'input-validation', 'error-handling', 'safe-migrations'],
  },
  debugger: { group: 'coding', engine: 'omp', skills: ['reproduce-first', 'diagnosing-bugs'] },
  reviewer: { group: 'coding', engine: 'omp', skills: ['code-review', 'security-basics'] },
};

describe('isi role dan skill di repo', () => {
  it('memuat tepat 7 role awal', () => {
    expect([...registry.roles.keys()].sort()).toEqual([...INITIAL_ROLE_IDS].sort());
    expect(Object.keys(SPEC).sort()).toEqual([...INITIAL_ROLE_IDS].sort());
  });

  it.each(Object.entries(SPEC))(
    'role %s: frontmatter lengkap dan sesuai tabel dokumen',
    (id, spec) => {
      const role = registry.roles.get(id)!;
      expect(RoleIdSchema.safeParse(role.id).success).toBe(true);
      expect([role.group, role.engine]).toEqual([spec.group, spec.engine]);
      expect(role.name).not.toBe('');
      expect(role.model).not.toBe('');
      expect(role.fallbackModel).not.toBeNull();
      // Skill inti ada di frontmatter; skill khusus persis seperti di tabel.
      expect(role.skills.filter((s) => (CORE_SKILLS as readonly string[]).includes(s))).toEqual([
        ...CORE_SKILLS,
      ]);
      expect(role.skills.filter((s) => !(CORE_SKILLS as readonly string[]).includes(s))).toEqual(
        spec.skills,
      );
      expect(role.examples.length).toBeGreaterThanOrEqual(5);
      expect(role.notExamples.length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(role.handoff).length).toBeGreaterThan(0);
      for (const target of Object.keys(role.handoff)) expect(registry.roles.has(target)).toBe(true);
    },
  );

  it('isi role memuat bagian Peran, Cara kerja, Definition of done, dan Format output', () => {
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

  it('role coding bertanya sebelum mengubah; role baca-saja boleh auto-safe', () => {
    for (const id of ['frontend', 'backend', 'debugger']) {
      expect(registry.roles.get(id)!.approval).toBe('ask');
    }
    expect(registry.roles.get('reviewer')!.approval).toBe('auto-safe');
  });

  it('contoh tidak dobel antar role, supaya router tidak mendapat sinyal bertentangan', () => {
    const owner = new Map<string, string>();
    for (const role of registry.roles.values()) {
      for (const example of role.examples) {
        expect(owner.get(example), example).toBeUndefined();
        owner.set(example, role.id);
      }
    }
    for (const role of registry.roles.values()) {
      for (const notExample of role.notExamples) {
        expect(owner.get(notExample), `non-contoh ${notExample}`).not.toBe(role.id);
      }
    }
  });

  it('semua skill (5 inti + khusus yang dirujuk) ada, ringkas, dan berbentuk checklist', () => {
    const referenced = new Set<string>(CORE_SKILLS);
    for (const spec of Object.values(SPEC)) for (const s of spec.skills) referenced.add(s);
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
  it.each([...registry.roles.keys()])('role %s: di bawah anggaran dan semua bagian ada', (id) => {
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
    // Urutan: aturan perilaku, role, skill inti, skill khusus.
    const at = (text: string) => bundle.systemPrompt.indexOf(text);
    expect(at('# Aturan perilaku agent')).toBe(0);
    expect(at('# Aturan perilaku agent')).toBeLessThan(at(`# Peran: ${role.name}`));
    expect(at(`# Peran: ${role.name}`)).toBeLessThan(at('# Skill inti'));
    expect(at('# Skill inti')).toBeLessThan(at('# Skill khusus'));
  });

  it('role tidak memuat skill role lain', () => {
    const general = buildBundle(registry, 'general').systemPrompt;
    expect(general).not.toContain(registry.skills.get('ui-baseline')!.body);
    expect(general).not.toContain('## code-review');
  });

  it('anggaran sempit: skill inti tetap masuk, skill khusus yang tidak muat dilewati utuh', () => {
    const tight = buildBundle(registry, 'frontend', { skillsBudget: 900 });
    expect(tight.skills.slice(0, 5)).toEqual([...CORE_SKILLS]);
    expect(tight.omittedSkills.length).toBeGreaterThan(0);
    for (const id of tight.omittedSkills) {
      expect(tight.systemPrompt).not.toContain(`## ${id}\n`);
    }
    expect(tight.tokens.skills).toBeLessThanOrEqual(900);
    expect(tight.overBudget).toBe(false);
    // Skill inti tidak pernah dibuang; bila anggaran lebih kecil darinya, bundel ditandai melebihi anggaran.
    const tiny = buildBundle(registry, 'frontend', { skillsBudget: 100 });
    expect(tiny.skills).toEqual([...CORE_SKILLS]);
    expect(tiny.overBudget).toBe(true);
  });

  it('role yang tidak ada: UnknownRoleError', () => {
    expect(() => buildBundle(registry, 'tukang-sulap')).toThrow(UnknownRoleError);
  });

  it('ukuran bundel tiap role (untuk dipantau)', () => {
    const sizes = Object.fromEntries(
      [...registry.roles.keys()].map((id) => [id, buildBundle(registry, id).tokens.total]),
    );
    expect(Math.max(...Object.values(sizes))).toBeLessThanOrEqual(BUNDLE_TOKEN_BUDGET);
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
    expect(loadRegistry(sandbox()).roles.size).toBe(7);
  });

  it('role merujuk skill yang tidak ada: gagal dengan menyebut file dan skill-nya', () => {
    const dir = sandbox();
    edit(join(dir, 'roles', 'frontend.md'), (t) => t.replace('react-practices', 'skill-hantu'));
    expect(problemsOf(dir)).toEqual([
      'roles/frontend.md: merujuk skill "skill-hantu" yang tidak ada',
    ]);
  });

  it('id tidak sama dengan nama file, field asing, dan contoh kurang: semua dilaporkan sekaligus', () => {
    const dir = sandbox();
    edit(join(dir, 'roles', 'writer.md'), (t) => t.replace('id: writer', 'id: penulis'));
    edit(join(dir, 'roles', 'debugger.md'), (t) =>
      t.replace('approval: ask', 'approval: ask\nwarna: merah'),
    );
    edit(join(dir, 'roles', 'reviewer.md'), (t) =>
      t.replace(/examples:\n( {2}- .*\n)+/, 'examples:\n  - satu\n  - dua\n'),
    );
    const problems = problemsOf(dir).join('\n');
    expect(problems).toContain('roles/writer.md: id "penulis" harus sama dengan nama file');
    expect(problems).toMatch(/roles\/debugger\.md: .*warna/);
    expect(problems).toMatch(/roles\/reviewer\.md: examples/);
  });

  it('enum salah, YAML rusak, frontmatter hilang, dan isi kosong', () => {
    const dir = sandbox();
    edit(join(dir, 'roles', 'general.md'), (t) => t.replace('engine: hermes', 'engine: gpt'));
    edit(join(dir, 'roles', 'backend.md'), (t) => t.replace('name: Backend', 'name: [Backend'));
    writeFileSync(join(dir, 'roles', 'baru.md'), '# tanpa frontmatter\n');
    edit(
      join(dir, 'skills', 'citation', 'SKILL.md'),
      (t) => t.split('---\n').slice(0, 2).join('---\n') + '---\n',
    );
    const problems = problemsOf(dir);
    expect(problems.some((p) => p.startsWith('roles/general.md: engine'))).toBe(true);
    expect(problems.some((p) => p.startsWith('roles/backend.md: YAML tidak valid'))).toBe(true);
    expect(problems).toContain(
      'roles/baru.md: frontmatter (--- ... ---) tidak ditemukan di awal file',
    );
    expect(problems).toContain('skills/citation/SKILL.md: isi skill kosong');
  });

  it('skill inti hilang, nama skill tidak sama dengan folder, handoff ke role yang tidak ada', () => {
    const dir = sandbox();
    rmSync(join(dir, 'skills', 'scope-guard'), { recursive: true });
    edit(join(dir, 'skills', 'stop-slop', 'SKILL.md'), (t) =>
      t.replace('name: stop-slop', 'name: stop-sloppy'),
    );
    edit(join(dir, 'roles', 'debugger.md'), (t) => t.replace('  frontend:', '  arsitek:'));
    const problems = problemsOf(dir);
    expect(problems).toContain('skill inti "scope-guard" tidak ada');
    expect(problems).toContain(
      'skills/stop-slop/SKILL.md: name "stop-sloppy" harus sama dengan nama folder',
    );
    expect(problems).toContain('roles/debugger.md: handoff ke role "arsitek" yang tidak ada');
    // Role yang merujuk skill inti yang hilang ikut dilaporkan.
    expect(problems.filter((p) => p.includes('"scope-guard" yang tidak ada')).length).toBe(7);
  });

  it('skill tanpa SKILL.md, folder kosong, dan skill dobel di frontmatter role', () => {
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
    const text = '\uFEFF---\r\nname: x\r\n---\r\nisi\r\nbaris dua';
    expect(splitFrontmatter(text)).toEqual({ data: { name: 'x' }, body: 'isi\r\nbaris dua' });
  });
});
