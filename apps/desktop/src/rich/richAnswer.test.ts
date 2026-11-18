import { describe, expect, it } from 'vitest';
import { parseRichAnswer, richAnswerFallbackData } from './richAnswerParser';

describe('parseRichAnswer', () => {
  it('parses valid JSON within the size limit', () => {
    expect(
      parseRichAnswer(
        '{"version":1,"components":[{"id":"m","type":"metric","label":"A","value":1}]}',
      ),
    ).toMatchObject({ kind: 'valid' });
  });

  it('rejects malformed, unknown, and oversized JSON', () => {
    expect(parseRichAnswer('{')).toEqual({ kind: 'invalid' });
    expect(
      parseRichAnswer('{"version":1,"components":[{"id":"m","type":"gauge","value":1}]}'),
    ).toEqual({ kind: 'invalid' });
    expect(parseRichAnswer('x'.repeat(20 * 1024 + 1))).toEqual({ kind: 'invalid' });
  });

  it('field tak dikenal dibuang dan alias dipetakan sebelum validasi ketat', () => {
    expect(
      parseRichAnswer(
        '{"version":1,"components":[{"id":"m","type":"metric","label":"A","value":1,"style":"x"}]}',
      ),
    ).toEqual({
      kind: 'valid',
      value: { version: 1, components: [{ id: 'm', type: 'metric', label: 'A', value: 1 }] },
    });
    expect(
      parseRichAnswer(
        '{"version":1,"components":[{"type":"chart","chartType":"bar","labels":["a"],"values":["2"],"max":10}]}',
      ),
    ).toEqual({
      kind: 'valid',
      value: {
        version: 1,
        components: [
          { id: 'komponen-1', type: 'chart', chart: 'bar', labels: ['a'], values: [2] },
        ],
      },
    });
  });
});

describe('richAnswerFallbackData', () => {
  it('mengambil label+nilai, kolom+baris, dan item dari komponen yang tidak valid', () => {
    const code = JSON.stringify({
      version: 1,
      components: [
        {
          type: 'chart',
          chartType: 'bar',
          title: 'Skor',
          labels: ['A', 'B'],
          values: [9, '8'],
          max: 10,
        },
        { type: 'table', headers: ['Nama', 'Skor'], rows: [['A', 9], ['B']] },
        { type: 'kv', items: [{ key: 'Kota', value: 'Bandung' }, 'Bebas', { checked: true }] },
        { type: 'metric', label: 'Total', value: 3, style: 'x' },
        { type: 'chart', chartType: 'line' },
      ],
    });

    expect(richAnswerFallbackData(code)).toEqual([
      {
        kind: 'pairs',
        title: 'Skor',
        rows: [
          ['A', '9'],
          ['B', '8'],
        ],
      },
      {
        kind: 'table',
        title: undefined,
        columns: ['Nama', 'Skor'],
        rows: [
          ['A', '9'],
          ['B', ''],
        ],
      },
      { kind: 'list', title: undefined, items: ['Kota: Bandung', 'Bebas'] },
      { kind: 'list', items: ['Total: 3'] },
    ]);
  });

  it('kosong untuk JSON rusak, tanpa data dikenal, atau terlalu besar', () => {
    expect(richAnswerFallbackData('{bukan json')).toEqual([]);
    expect(richAnswerFallbackData('{"version":1,"components":[{"type":"chart"}]}')).toEqual([]);
    expect(richAnswerFallbackData('"teks"')).toEqual([]);
    expect(richAnswerFallbackData(`{"text":"${'x'.repeat(20 * 1024)}"}`)).toEqual([]);
  });
});
