import { TeamPlanSchema } from '@aios/contracts';
import { describe, expect, it } from 'vitest';
import { __internal } from './orchestrator.js';

/**
 * Parser blok ```orca-plan/```orca-review di jawaban Lead -- bagian orkestrator yang bisa diuji tanpa
 * Postgres/pg-boss. Tes integrasi penuh (dispatch Worker, tinjauan, pembatalan, restart) ada di
 * orchestrator.integration.test.ts, butuh TEST_DATABASE_URL (lihat REPAIR_LOG P7: tidak bisa dijalankan
 * di VPS pengembangan ini).
 */
describe('orchestrator: parseBlock', () => {
  const { parseBlock, PLAN_BLOCK, REVIEW_BLOCK } = __internal;

  it('mengurai blok orca-plan yang valid, mengabaikan teks sebelum dan sesudahnya', () => {
    const text = [
      'Saya akan memecah ini jadi dua tugas.',
      '',
      '```orca-plan',
      JSON.stringify({
        tasks: [
          { title: 'Tugas A', prompt: 'Kerjakan A', acceptanceCriteria: 'A selesai' },
          { title: 'Tugas B', prompt: 'Kerjakan B', acceptanceCriteria: 'B selesai' },
        ],
      }),
      '```',
      '',
      'Semoga membantu.',
    ].join('\n');
    const plan = parseBlock(text, PLAN_BLOCK, TeamPlanSchema);
    expect(plan?.tasks).toHaveLength(2);
    expect(plan?.tasks[0]?.title).toBe('Tugas A');
  });

  it('mengembalikan null bila blok tidak ada', () => {
    expect(parseBlock('Tidak ada blok di sini.', PLAN_BLOCK, TeamPlanSchema)).toBeNull();
  });

  it('mengembalikan null bila JSON di dalam blok rusak', () => {
    const text = '```orca-plan\n{bukan json valid\n```';
    expect(parseBlock(text, PLAN_BLOCK, TeamPlanSchema)).toBeNull();
  });

  it('mengembalikan null bila JSON valid tapi tidak sesuai TeamPlanSchema (tasks kosong)', () => {
    const text = '```orca-plan\n{"tasks":[]}\n```';
    expect(parseBlock(text, PLAN_BLOCK, TeamPlanSchema)).toBeNull();
  });

  it('menolak lebih dari 8 tugas (MAX_TEAM_PLAN_TASKS)', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => ({
      title: `T${i}`,
      prompt: `P${i}`,
      acceptanceCriteria: `C${i}`,
    }));
    const text = `\`\`\`orca-plan\n${JSON.stringify({ tasks })}\n\`\`\``;
    expect(parseBlock(text, PLAN_BLOCK, TeamPlanSchema)).toBeNull();
  });

  it('mengurai blok orca-review untuk ketiga keputusan', () => {
    const schema = {
      parse: (v: unknown) => {
        const obj = v as { decision?: unknown; feedback?: unknown };
        if (!['accept', 'revise', 'reject'].includes(obj.decision as string)) {
          throw new Error('decision tidak valid');
        }
        return {
          decision: obj.decision as string,
          feedback: typeof obj.feedback === 'string' ? obj.feedback : '',
        };
      },
    };
    for (const decision of ['accept', 'revise', 'reject']) {
      const text = `\`\`\`orca-review\n${JSON.stringify({ decision, feedback: 'catatan' })}\n\`\`\``;
      expect(parseBlock(text, REVIEW_BLOCK, schema)?.decision).toBe(decision);
    }
  });

  it('mengembalikan null untuk keputusan di luar accept/revise/reject', () => {
    const schema = {
      parse: (v: unknown) => {
        const obj = v as { decision?: unknown };
        if (!['accept', 'revise', 'reject'].includes(obj.decision as string)) {
          throw new Error('decision tidak valid');
        }
        return obj;
      },
    };
    const text = '```orca-review\n{"decision":"maybe","feedback":"?"}\n```';
    expect(parseBlock(text, REVIEW_BLOCK, schema)).toBeNull();
  });
});
