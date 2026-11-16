import { MEMORY_TEXT_MAX } from '@aios/contracts';
import { describe, expect, it } from 'vitest';
import { RECALL_SECTION_HEADER } from '../modules/memory/recall.js';
import { MEMORY_EVAL_FACTS, MEMORY_EVAL_QUERIES } from './eval-memory.data.js';
import { EVAL_BUDGET_CHARS } from './eval-memory.run.js';

describe('set evaluasi recall memori (offline, memastikan data uji sendiri valid)', () => {
  it('60 fakta dan 40 kueri dengan lima kategori; kunci dan teks unik, panjang fakta sah', () => {
    expect(MEMORY_EVAL_FACTS).toHaveLength(60);
    expect(MEMORY_EVAL_QUERIES).toHaveLength(40);
    expect(new Set(MEMORY_EVAL_FACTS.map((f) => f.key)).size).toBe(60);
    expect(new Set(MEMORY_EVAL_FACTS.map((f) => f.text)).size).toBe(60);
    expect(new Set(MEMORY_EVAL_QUERIES.map((q) => q.category))).toEqual(
      new Set(['kata', 'parafrase', 'lintas-bahasa', 'susulan', 'negatif']),
    );
    for (const fact of MEMORY_EVAL_FACTS)
      expect(fact.text.length).toBeLessThanOrEqual(MEMORY_TEXT_MAX);
  });

  it('label relevan menunjuk fakta yang ada dan tidak tersemat; hanya kueri negatif yang tanpa label', () => {
    const facts = new Map(MEMORY_EVAL_FACTS.map((f) => [f.key, f]));
    for (const query of MEMORY_EVAL_QUERIES) {
      expect(query.relevant.length === 0, query.text).toBe(query.category === 'negatif');
      for (const key of query.relevant) {
        expect(facts.has(key), `${key} untuk "${query.text}"`).toBe(true);
        expect(facts.get(key)!.pinned ?? false, `${key} tersemat`).toBe(false);
      }
    }
  });

  it('hanya kueri susulan yang membawa pesan sebelumnya', () => {
    for (const query of MEMORY_EVAL_QUERIES) {
      expect(query.previous !== undefined, query.text).toBe(query.category === 'susulan');
    }
  });

  it('fixture melebihi anggaran evaluasi, jadi mode lexical benar-benar memilih', () => {
    const chars = MEMORY_EVAL_FACTS.reduce((sum, f) => sum + f.text.length + 3, 0);
    expect(RECALL_SECTION_HEADER.length + chars).toBeGreaterThan(EVAL_BUDGET_CHARS * 2);
  });
});
