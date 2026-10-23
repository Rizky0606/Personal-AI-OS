import { INITIAL_ROLE_IDS } from '@aios/contracts';
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../registry.js';
import { createRouter, type Complete } from '../router/index.js';
import { loadEvalCases, parseEvalCases, type EvalCase } from './dataset.js';
import {
  DEFAULT_EVAL_THRESHOLD,
  evaluate,
  formatReport,
  modelUnavailable,
  passes,
  summarize,
  type CaseResult,
} from './evaluate.js';

const registry = loadRegistry();
const cases = loadEvalCases();

describe('dataset routing.jsonl', () => {
  it('memuat minimal 10 kasus untuk setiap role awal, semua role-nya dikenal', () => {
    for (const role of INITIAL_ROLE_IDS) {
      const count = cases.filter((c) => c.expect === role).length;
      expect(count, role).toBeGreaterThanOrEqual(10);
    }
    for (const c of cases) expect(registry.roles.has(c.expect), c.id).toBe(true);
  });

  it('memuat kasus lanjutan (tiap role) dan kasus ambigu', () => {
    for (const role of INITIAL_ROLE_IDS) {
      const lanjutan = cases.filter((c) => c.expect === role && c.tags?.includes('lanjutan'));
      expect(lanjutan.length, `lanjutan ${role}`).toBeGreaterThanOrEqual(1);
      for (const c of lanjutan) expect(c.previousRole, c.id).toBe(role);
    }
    expect(cases.filter((c) => c.tags?.includes('ambigu')).length).toBeGreaterThanOrEqual(4);
    expect(
      cases.filter((c) => c.tags?.includes('android-tanpa-project')).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('konsisten dengan aturan konteks: role coding hanya diharapkan bila ada project', () => {
    for (const c of cases) {
      const role = registry.roles.get(c.expect)!;
      if (role.group === 'coding') expect(c.project, c.id).toBeDefined();
      if (c.tags?.includes('android-tanpa-project')) {
        expect(c.project, c.id).toBeUndefined();
        expect(c.expect, c.id).toBe('general');
      }
    }
  });

  it('id dan pesan unik, dan bukan salinan contoh di file role (dataset terpisah dari prompt)', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    const messages = cases.map((c) => c.message.toLowerCase());
    expect(
      new Set(messages).size - new Set(messages.filter((m) => m.length > 12)).size,
    ).toBeLessThanOrEqual(messages.length);
    const examples = new Set(
      [...registry.roles.values()]
        .flatMap((r) => [...r.examples, ...r.notExamples])
        .map((e) => e.toLowerCase()),
    );
    for (const c of cases) expect(examples.has(c.message.toLowerCase()), c.id).toBe(false);
  });

  it('parseEvalCases menolak baris rusak dengan nomor barisnya', () => {
    expect(() => parseEvalCases('{bukan json')).toThrow(/baris 1: bukan JSON/);
    expect(() =>
      parseEvalCases(
        `${JSON.stringify({ id: 'a', message: 'x', surface: 'android', expect: 'general' })}\n${JSON.stringify({ id: 'b', message: 'x', surface: 'tv', expect: 'general' })}`,
      ),
    ).toThrow(/baris 2: surface/);
    expect(() =>
      parseEvalCases(
        [1, 2]
          .map(() =>
            JSON.stringify({ id: 'a', message: 'x', surface: 'android', expect: 'general' }),
          )
          .join('\n'),
      ),
    ).toThrow(/baris 2: id "a" dobel/);
    expect(() =>
      parseEvalCases(
        JSON.stringify({ id: 'a', message: 'x', surface: 'android', expect: 'general', ekstra: 1 }),
      ),
    ).toThrow(/baris 1/);
  });
});

/** Model tiruan yang membaca pesan terakhir dari prompt dan menjawab sesuai `answer`. */
function fakeModel(answer: (c: EvalCase) => string | undefined): Complete {
  const byMessage = new Map(cases.map((c) => [c.message, c]));
  return ({ messages }) => {
    const user = messages.find((m) => m.role === 'user')!.content;
    const message = /<<<\n([\s\S]*?)\n>>>/.exec(user)![1]!;
    const item = byMessage.get(message)!;
    const role = answer(item);
    if (role === undefined) return Promise.reject(new Error('model mati'));
    return Promise.resolve(
      JSON.stringify({ role, confidence: 0.9, reason: 'tiruan', needs_split: false, subtasks: [] }),
    );
  };
}

const routerWith = (complete: Complete) => createRouter({ registry: () => registry, complete });

describe('harness evaluasi', () => {
  it('model yang selalu benar: 100%, lulus; kasus lanjutan selesai lewat aturan tanpa model', async () => {
    const report = await evaluate(cases, routerWith(fakeModel((c) => c.expect)));
    expect(report.overall.accuracy).toBe(1);
    expect(passes(report)).toBe(true);
    expect(report.perRole.map((r) => r.role).sort()).toEqual([...INITIAL_ROLE_IDS].sort());
    expect(report.sources.rule).toBeGreaterThanOrEqual(4);
    expect(report.sources.fallback).toBe(0);
    expect(modelUnavailable(report)).toBe(false);
  });

  it('model "naif" yang memilih role coding untuk chat tanpa project tetap benar berkat aturan konteks', async () => {
    const naive = fakeModel((c) =>
      c.tags?.includes('android-tanpa-project') ? 'debugger' : c.expect,
    );
    const report = await evaluate(cases, routerWith(naive));
    for (const r of report.results.filter((x) => x.case.tags?.includes('android-tanpa-project'))) {
      expect(r.got, r.case.id).toBe('general');
      expect(r.correct).toBe(true);
    }
    expect(passes(report)).toBe(true);
  });

  it('model yang selalu menjawab general: gagal, dengan akurasi per role yang terbaca', async () => {
    const report = await evaluate(cases, routerWith(fakeModel(() => 'general')));
    expect(passes(report)).toBe(false);
    const writer = report.perRole.find((r) => r.role === 'writer')!;
    expect(writer.accuracy).toBeLessThan(0.5);
    const text = formatReport(report);
    expect(text).toContain('KESELURUHAN');
    expect(text).toMatch(/writer\s+\d+\/\d+\s+\d+\.\d%\s+!/);
    expect(text).toContain('Salah (');
  });

  it('model tidak terjangkau: terdeteksi sebagai kegagalan lingkungan, bukan akurasi', async () => {
    const report = await evaluate(cases, routerWith(fakeModel(() => undefined)));
    expect(modelUnavailable(report)).toBe(true);
    expect(passes(report)).toBe(false);
  });

  it(`ambang ${DEFAULT_EVAL_THRESHOLD}: 9/10 lulus, 8/10 gagal, dan satu role buruk menggagalkan walau rata-rata tinggi`, () => {
    const result = (role: string, i: number, correct: boolean): CaseResult => ({
      case: { id: `${role}-${i}`, message: 'x', surface: 'android', expect: role },
      got: correct ? role : 'general',
      confidence: 0.9,
      reason: '',
      source: 'ai',
      correct,
    });
    const make = (role: string, ok: number, total: number) =>
      Array.from({ length: total }, (_, i) => result(role, i, i < ok));

    expect(passes(summarize([...make('writer', 9, 10), ...make('researcher', 10, 10)]))).toBe(true);
    expect(passes(summarize([...make('writer', 8, 10), ...make('researcher', 10, 10)]))).toBe(
      false,
    );
    // Rata-rata 93,8% tetapi satu role 70%: gagal.
    expect(
      passes(
        summarize([
          ...make('writer', 7, 10),
          ...make('researcher', 10, 10),
          ...make('general', 30, 30),
        ]),
      ),
    ).toBe(false);
    expect(passes(summarize([]))).toBe(false);
  });
});
