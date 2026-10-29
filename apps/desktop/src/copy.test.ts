import { describe, expect, it } from 'vitest';
import { copy } from './copy';

describe('copy', () => {
  it('tidak ada teks "Role otomatis" yang tersisa (routing tetap otomatis, tanpa labelnya)', () => {
    const texts: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === 'string') texts.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(copy);
    expect(texts.filter((t) => /role otomatis/i.test(t))).toEqual([]);
  });
});
