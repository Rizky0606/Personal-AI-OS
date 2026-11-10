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
  selectSkills,
  estimateTokens,
  loadRegistry,
  splitFrontmatter,
} from './index.js';

const registry = loadRegistry();

/** Agent di ROLES_AND_SKILLS.md: grup, mesin, dan skill milik agent itu sendiri (di luar skill inti). */
const SPEC: Record<string, { group: string; engine: string; skills: string[] }> = {
  general: {
    group: 'umum',
    engine: 'hermes',
    skills: ['answer-first', 'clarify-once', 'find-skills'],
  },
  project: { group: 'coding', engine: 'omp', skills: ['find-skills', 'plan-progress'] },
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
      expect(skill.description.length, `${skill.id} deskripsi > 200 karakter`).toBeLessThanOrEqual(
        200,
      );
      expect(
        skill.description,
        `${skill.id}: deskripsi harus menyebut kapan dipakai (saat/sebelum/untuk/bila/...)`,
      ).toMatch(/\b(saat|ketika|sebelum|setelah|bila|jika|untuk|khusus|di setiap)\b/i);
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

describe('skill inti rich-answers (jawaban kaya untuk semua role)', () => {
  const body = registry.skills.get('rich-answers')!.body;

  it('skill inti: dimuat untuk setiap agent, chat umum dan project, tanpa kata kunci', () => {
    expect(CORE_SKILLS).toContain('rich-answers');
    for (const id of registry.roles.keys()) {
      const bundle = buildBundle(registry, id);
      expect(bundle.skills, id).toContain('rich-answers');
      expect(bundle.systemPrompt, id).toContain(body);
    }
  });

  it('bukan lagi bagian paket frontend (projectOnly) atau paket mana pun', () => {
    for (const pack of SKILL_PACKS) expect(pack.skills, pack.id).not.toContain('rich-answers');
    const frontend = SKILL_PACKS.find((p) => p.id === 'frontend')!;
    // Pesan tanpa kata kunci tampilan tetap memuatnya lewat skill inti; paket frontend tidak lagi menjadi pintunya.
    expect(frontend.skills).not.toContain('rich-answers');
    // Pemilihan kata kunci tidak pernah mengembalikan rich-answers (skill inti tidak termasuk hasil pemilihan).
    for (const agent of ['general', 'project']) {
      const picked = selectSkills('Bandingkan 3 opsi database dalam tabel dan tombol UI css', {
        agent,
      });
      expect(picked.skills).not.toContain('rich-answers');
    }
    expect(buildBundle(registry, 'general').skills).toContain('rich-answers');
  });

  it('memandu pemilihan komponen: perbandingan, deret angka, pilihan, langkah, angka penting', () => {
    for (const pair of [
      ['table', 'perbandingan'],
      ['chart', 'deret angka'],
      ['choices', 'pilihan'],
      ['steps', 'langkah'],
      ['metric', 'angka penting'],
    ] as const) {
      expect(body.toLowerCase(), pair[0]).toContain(pair[0]);
      expect(body.toLowerCase(), pair[1]).toContain(pair[1]);
    }
  });

  it('menyebut kapan TIDAK dipakai, batas 3 komponen, dan contoh benar dan salah', () => {
    expect(body).toContain('JANGAN pakai');
    expect(body).toMatch(/jawaban singkat/);
    expect(body).toMatch(/percakapan biasa/);
    expect(body).toContain('Maksimal 3 komponen');
    expect(body).toContain('Benar:');
    expect(body).toContain('Salah:');
    // Tidak lagi bergantung pada capability engine tertentu.
    expect(body).not.toContain('capability');
  });

  it('contoh blok di skill adalah JSON valid menurut skema komponen', () => {
    const start = body.indexOf('```aios-ui\n') + '```aios-ui\n'.length;
    const block = body.slice(start, body.indexOf('\n```', start));
    expect(block).toBeDefined();
    const parsed = JSON.parse(block) as { version: number; components: { type: string }[] };
    expect(parsed.version).toBe(1);
    expect(parsed.components.length).toBeLessThanOrEqual(3);
    expect(parsed.components[0]!.type).toBe('table');
  });
});

describe('skill plan-progress (rencana untuk panel Progres)', () => {
  const body = registry.skills.get('plan-progress')!.body;

  it('mewajibkan rencana tool todo untuk tugas 3 langkah atau lebih, tanpa rencana untuk tugas sederhana', () => {
    for (const phrase of [
      'tool `todo`',
      '3 langkah atau lebih',
      'WAJIB',
      '3 sampai 12 langkah',
      'Periksa hasil',
      'tepat satu langkah `in_progress`',
      'jangan buat rencana',
    ]) {
      expect(body, phrase).toContain(phrase);
    }
  });

  it('memperbarui status tiap langkah selesai dan mengenal status abandoned dan blocked', () => {
    for (const status of ['completed', 'pending', 'abandoned', 'blocked']) {
      expect(body, status).toContain(status);
    }
    expect(body).toMatch(/saat itu juga/);
  });

  it('dimuat hanya untuk mesin yang punya tool todo (omp): agent project, bukan Hermes atau riset', () => {
    expect(buildBundle(registry, 'project').skills).toContain('plan-progress');
    expect(buildBundle(registry, 'general').skills).not.toContain('plan-progress');
    expect(buildBundle(registry, 'researcher').skills).not.toContain('plan-progress');
    expect(buildBundle(registry, 'project').systemPrompt).toContain(body);
    expect(buildBundle(registry, 'general').systemPrompt).not.toContain(body);
  });

  it('muat bersama paket skill terbanyak tanpa melewati anggaran token', () => {
    const bundle = buildBundle(registry, 'project', {
      extraSkills: ['ui-baseline', 'a11y-check', 'ui-states', 'react-practices'],
    });
    expect(bundle.omittedSkills).toEqual([]);
    expect(bundle.skills).toContain('plan-progress');
  });

  it('rencana satu kalimat per langkah: isi skill ringkas (di bawah 1.000 token)', () => {
    expect(estimateTokens(body)).toBeLessThan(1000);
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
    expect(withUi.skills).toEqual([
      ...CORE_SKILLS,
      'find-skills',
      'plan-progress',
      'ui-baseline',
      'a11y-check',
    ]);
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
    // Anggaran sempit = hanya muat skill inti ditambah sedikit; ikut ukuran skill inti saat ini.
    const coreTokens = buildBundle(registry, 'project', { skillsBudget: 1 }).tokens.skills;
    const budget = coreTokens + 300;
    const tight = buildBundle(registry, 'project', { skillsBudget: budget, extraSkills });
    expect(tight.skills.slice(0, CORE_SKILLS.length)).toEqual([...CORE_SKILLS]);
    expect(tight.omittedSkills.length).toBeGreaterThan(0);
    for (const id of tight.omittedSkills) {
      expect(tight.systemPrompt).not.toContain(`## ${id}\n`);
    }
    expect(tight.tokens.skills).toBeLessThanOrEqual(budget);
    expect(tight.overBudget).toBe(false);
    const tiny = buildBundle(registry, 'project', { skillsBudget: 100, extraSkills });
    expect(tiny.skills).toEqual([...CORE_SKILLS]);
    expect(tiny.overBudget).toBe(true);
  });

  it('agent yang tidak ada: UnknownRoleError', () => {
    expect(() => buildBundle(registry, 'tukang-sulap')).toThrow(UnknownRoleError);
  });
});

describe('skill tersedia lewat indeks, bukan ditempel utuh (P9)', () => {
  it('skillNamePrefix mengubah nama di baris indeks (Hermes: aios-<id>) tanpa mengubah id yang dilaporkan', () => {
    const bundle = buildBundle(registry, 'project', {
      suggestedSkills: ['ui-baseline'],
      skillNamePrefix: 'aios-',
    });
    expect(bundle.offeredSkills).toEqual(['ui-baseline']);
    expect(bundle.systemPrompt).toContain(
      `- aios-ui-baseline: ${registry.skills.get('ui-baseline')!.description}`,
    );
    expect(bundle.systemPrompt).not.toContain('\n- ui-baseline:');
  });

  it('suggestedSkills hanya muncul sebagai baris indeks (id + deskripsi), isi tidak ditempel', () => {
    const bundle = buildBundle(registry, 'project', {
      suggestedSkills: ['ui-baseline', 'a11y-check'],
    });
    expect(bundle.skills).not.toContain('ui-baseline');
    expect(bundle.skills).not.toContain('a11y-check');
    expect(bundle.offeredSkills.sort()).toEqual(['a11y-check', 'ui-baseline']);
    expect(bundle.systemPrompt).not.toContain(registry.skills.get('ui-baseline')!.body);
    expect(bundle.systemPrompt).toContain('# Skill tersedia (buka bila relevan');
    expect(bundle.systemPrompt).toContain(
      `- ui-baseline: ${registry.skills.get('ui-baseline')!.description}`,
    );
    expect(bundle.systemPrompt).toContain(
      `- a11y-check: ${registry.skills.get('a11y-check')!.description}`,
    );
  });

  it('skill yang sama di extraSkills (pilihan manual) menang: ditempel utuh, tidak masuk indeks', () => {
    const bundle = buildBundle(registry, 'project', {
      extraSkills: ['ui-baseline'],
      suggestedSkills: ['ui-baseline', 'a11y-check'],
    });
    expect(bundle.skills).toContain('ui-baseline');
    expect(bundle.systemPrompt).toContain(registry.skills.get('ui-baseline')!.body);
    expect(bundle.offeredSkills).toEqual(['a11y-check']);
  });

  it('skill milik agent sendiri (role.skills) tidak pernah diturunkan jadi indeks', () => {
    const bundle = buildBundle(registry, 'project', {
      suggestedSkills: ['find-skills', 'ui-baseline'],
    });
    expect(bundle.skills).toContain('find-skills');
    expect(bundle.systemPrompt).toContain(registry.skills.get('find-skills')!.body);
    expect(bundle.offeredSkills).toEqual(['ui-baseline']);
  });

  it('eagerSkillPacks: fallback mesin tanpa indeks, suggestedSkills ditempel utuh seperti extraSkills', () => {
    const bundle = buildBundle(registry, 'project', {
      suggestedSkills: ['ui-baseline', 'a11y-check'],
      eagerSkillPacks: true,
    });
    expect(bundle.offeredSkills).toEqual([]);
    expect(bundle.systemPrompt).not.toContain('# Skill tersedia');
    expect(bundle.skills).toContain('ui-baseline');
    expect(bundle.skills).toContain('a11y-check');
    expect(bundle.systemPrompt).toContain(registry.skills.get('ui-baseline')!.body);
  });

  it('skill tak dikenal di suggestedSkills diabaikan (tidak masuk indeks maupun error)', () => {
    const bundle = buildBundle(registry, 'project', { suggestedSkills: ['skill-hantu'] });
    expect(bundle.offeredSkills).toEqual([]);
    expect(bundle.systemPrompt).not.toContain('skill-hantu');
  });

  it('indeks tidak dihitung ke anggaran skill (hanya deskripsi pendek)', () => {
    const base = buildBundle(registry, 'project');
    const withIndex = buildBundle(registry, 'project', {
      suggestedSkills: SKILL_PACKS.flatMap((p) => p.skills),
    });
    expect(withIndex.tokens.skills).toBe(base.tokens.skills);
    expect(withIndex.tokens.total).toBeGreaterThan(base.tokens.total);
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
