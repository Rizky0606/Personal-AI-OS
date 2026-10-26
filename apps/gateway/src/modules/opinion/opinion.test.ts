import { describe, expect, it } from 'vitest';
import { MAX_FINDINGS, parseOpinion } from './service.js';

const paths = new Set(['src/a.ts', 'src/b.ts']);

describe('parseOpinion', () => {
  it('membaca JSON polos dan yang dibungkus pagar kode atau teks', () => {
    const json = JSON.stringify({
      summary: 'Ada satu bug.',
      findings: [{ path: 'src/a.ts', line: 12, severity: 'bug', body: 'Null tidak dicek.' }],
    });
    const expected = {
      summary: 'Ada satu bug.',
      findings: [{ path: 'src/a.ts', line: 12, severity: 'bug', body: 'Null tidak dicek.' }],
    };
    expect(parseOpinion(json, paths)).toEqual(expected);
    expect(parseOpinion('```json\n' + json + '\n```', paths)).toEqual(expected);
    expect(parseOpinion(`Berikut hasilnya: ${json} semoga membantu`, paths)).toEqual(expected);
  });

  it('membuang temuan di luar berkas yang ditinjau; baris dan tingkat tak sah dinormalkan', () => {
    const out = parseOpinion(
      JSON.stringify({
        summary: 's',
        findings: [
          { path: 'rahasia.txt', line: 1, severity: 'bug', body: 'luar' },
          { path: 'src/b.ts', line: 0, severity: 'kritis', body: 'normalkan' },
          { path: 'src/b.ts', line: 3.5, severity: 'warning', body: 'pecahan' },
          { path: 'src/b.ts', line: 4, severity: 'info', body: '   ' },
          'bukan objek',
        ],
      }),
      paths,
    );
    expect(out.findings).toEqual([
      { path: 'src/b.ts', line: null, severity: 'info', body: 'normalkan' },
      { path: 'src/b.ts', line: null, severity: 'warning', body: 'pecahan' },
    ]);
  });

  it(`maksimal ${MAX_FINDINGS} temuan`, () => {
    const findings = Array.from({ length: 25 }, (_, i) => ({
      path: 'src/a.ts',
      line: i + 1,
      severity: 'info',
      body: `t${i}`,
    }));
    expect(parseOpinion(JSON.stringify({ summary: '', findings }), paths).findings).toHaveLength(
      MAX_FINDINGS,
    );
  });

  it('bukan JSON: ringkasan berisi teks mentah (dipotong), tanpa temuan', () => {
    const out = parseOpinion('Kodenya terlihat baik.', paths);
    expect(out).toEqual({ summary: 'Kodenya terlihat baik.', findings: [] });
    expect(parseOpinion('x'.repeat(900), paths).summary).toHaveLength(500);
    expect(parseOpinion('{rusak', paths).findings).toEqual([]);
  });
});
