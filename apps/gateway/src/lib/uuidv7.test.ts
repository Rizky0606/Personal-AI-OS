import { IdSchema } from '@aios/contracts';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuidv7.js';

describe('uuidv7', () => {
  it('menghasilkan UUIDv7 yang lolos IdSchema di contracts', () => {
    for (let i = 0; i < 200; i++) expect(IdSchema.safeParse(uuidv7()).success).toBe(true);
  });

  it('menyimpan waktu di 48 bit pertama', () => {
    const t = Date.UTC(2026, 9, 22, 6, 38, 0);
    const id = uuidv7(t + 1_000_000);
    const ms = parseInt(id.replaceAll('-', '').slice(0, 12), 16);
    expect(ms).toBeGreaterThanOrEqual(t);
  });

  it('berurutan secara leksikografis walau dibuat dalam milidetik yang sama', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('tetap monoton bila jam mundur', () => {
    const a = uuidv7(Date.now() + 10_000);
    const b = uuidv7(Date.now());
    expect(b > a).toBe(true);
  });
});
