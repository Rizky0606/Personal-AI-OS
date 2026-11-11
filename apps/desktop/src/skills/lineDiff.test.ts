import { describe, expect, it } from 'vitest';
import { hasChanges, lineDiff } from './lineDiff';

describe('lineDiff', () => {
  it('menandai baris yang ditambah dan dihapus', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });
  it('isi sama tidak punya perubahan', () => {
    expect(hasChanges(lineDiff('x\ny', 'x\ny'))).toBe(false);
  });
});
