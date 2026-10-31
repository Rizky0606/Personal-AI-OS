import { describe, expect, it } from 'vitest';
import { RichAnswerFollowUpSchema, RichAnswerSchema, RICH_ANSWER_LIMITS } from './rich-answers.js';

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
