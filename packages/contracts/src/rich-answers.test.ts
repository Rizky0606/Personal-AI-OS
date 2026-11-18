import { describe, expect, it } from 'vitest';
import {
  RichAnswerFollowUpSchema,
  RichAnswerSchema,
  RICH_ANSWER_LIMITS,
  repairRichAnswer,
  repairRichAnswerBlocks,
} from './rich-answers.js';

const metric = {
  id: 'm1',
  type: 'metric' as const,
  label: 'Conversion',
  value: 42,
  trend: { value: 8, direction: 'up' as const, tone: 'success' as const },
};

describe('RichAnswerSchema', () => {
  it('accepts every supported component shape', () => {
    const result = RichAnswerSchema.safeParse({
      version: 1,
      components: [
        metric,
        { id: 't', type: 'table', columns: ['A', 'B'], rows: [['1', '2']] },
        { id: 'c', type: 'chart', chart: 'line', labels: ['Jan', 'Feb'], values: [1, 2] },
        { id: 'check', type: 'checklist', items: [{ id: 'a', label: 'Done', checked: false }] },
        { id: 'choice', type: 'choices', mode: 'single', options: [{ id: 'x', label: 'X' }] },
        { id: 'slider', type: 'slider', min: 0, max: 10, step: 1, value: 5, label: 'Level' },
        { id: 'callout', type: 'callout', tone: 'info', title: 'Note', text: 'Hello' },
        { id: 'steps', type: 'steps', items: [{ id: 'one', title: 'One', text: 'First' }] },
        { id: 'kv', type: 'kv', items: [{ key: 'A', value: 'B' }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown properties and unsupported types', () => {
    expect(
      RichAnswerSchema.safeParse({ version: 1, components: [{ ...metric, color: '#fff' }] })
        .success,
    ).toBe(false);
    expect(
      RichAnswerSchema.safeParse({ version: 1, components: [{ id: 'x', type: 'html' }] }).success,
    ).toBe(false);
  });

  it('enforces component and item limits', () => {
    const components = Array.from({ length: RICH_ANSWER_LIMITS.maxComponents + 1 }, (_, i) => ({
      ...metric,
      id: `m${i}`,
    }));
    expect(RichAnswerSchema.safeParse({ version: 1, components }).success).toBe(false);
  });
});

describe('RichAnswerFollowUpSchema', () => {
  it('accepts structured interaction values only', () => {
    expect(
      RichAnswerFollowUpSchema.safeParse({
        blockId: 'b',
        componentId: 'c',
        action: 'choice',
        value: ['a'],
      }).success,
    ).toBe(true);
    expect(
      RichAnswerFollowUpSchema.safeParse({
        blockId: 'b',
        componentId: 'c',
        action: 'choice',
        value: { script: 'alert(1)' },
      }).success,
    ).toBe(false);
  });
});

describe('repairRichAnswer / repairRichAnswerBlocks', () => {
  it('memperbaiki alias grafik dari model (chartType, max) lalu tetap lolos skema ketat', () => {
    const raw = {
      version: 1,
      components: [
        {
          id: 'popularitas-db',
          type: 'chart',
          chartType: 'bar',
          title: 'Skor popularitas',
          labels: ['PostgreSQL', 'MySQL', 'SQLite'],
          values: [9, '8', 7],
          max: 10,
        },
      ],
    };
    expect(RichAnswerSchema.safeParse(raw).success).toBe(false);
    expect(repairRichAnswer(raw)).toEqual({
      version: 1,
      components: [
        {
          id: 'popularitas-db',
          type: 'chart',
          chart: 'bar',
          label: 'Skor popularitas',
          labels: ['PostgreSQL', 'MySQL', 'SQLite'],
          values: [9, 8, 7],
        },
      ],
    });
  });

  it('data titik {label,value}, header tabel, id dan version yang hilang', () => {
    expect(
      repairRichAnswer({
        components: [
          {
            type: 'chart',
            data: [
              { label: 'Jan', value: 1 },
              { label: 'Feb', value: 2 },
            ],
          },
          { type: 'table', headers: ['A', 'B'], rows: [[1, true]] },
        ],
      }),
    ).toEqual({
      version: 1,
      components: [
        { id: 'komponen-1', type: 'chart', chart: 'bar', labels: ['Jan', 'Feb'], values: [1, 2] },
        { id: 'komponen-2', type: 'table', columns: ['A', 'B'], rows: [['1', 'true']] },
      ],
    });
  });

  it('yang tidak bisa diperbaiki tetap null', () => {
    expect(repairRichAnswer({ version: 1, components: [{ id: 'x', type: 'html' }] })).toBeNull();
    expect(
      repairRichAnswer({ components: [{ type: 'chart', labels: ['a', 'b'], values: [1] }] }),
    ).toBeNull();
    expect(repairRichAnswer('teks')).toBeNull();
  });

  it('blok di teks: yang bisa diperbaiki ditulis ulang, sisanya dibiarkan', () => {
    const bad =
      '{"version":1,"components":[{"id":"c","type":"chart","chartType":"line","labels":["a"],"values":[1],"max":3}]}';
    const valid =
      '{"version":1,"components":[{"id":"k","type":"kv","items":[{"key":"A","value":"B"}]}]}';
    const text = [
      'Pengantar.',
      '```aios-ui',
      bad,
      '```',
      'Tengah.',
      '```aios-ui',
      valid,
      '```',
      '```aios-ui',
      '{rusak',
      '```',
      '```json',
      bad,
      '```',
    ].join('\n');
    const repaired = repairRichAnswerBlocks(text);
    expect(repaired).toContain(
      '```aios-ui\n{"version":1,"components":[{"id":"c","type":"chart","chart":"line","labels":["a"],"values":[1]}]}\n```',
    );
    expect(repaired).toContain(`\`\`\`aios-ui\n${valid}\n\`\`\``);
    expect(repaired).toContain('```aios-ui\n{rusak\n```');
    expect(repaired).toContain(`\`\`\`json\n${bad}\n\`\`\``);
    expect(repairRichAnswerBlocks('tanpa blok')).toBe('tanpa blok');
  });
});
