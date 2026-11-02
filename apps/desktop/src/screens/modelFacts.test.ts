import { describe, expect, it } from 'vitest';
import { modelFacts } from './ModelSettings';

describe('modelFacts', () => {
  it('model biasa: jenis, penyedia, dan id', () => {
    expect(modelFacts({ id: 'gpt-x', kind: 'model', ownedBy: 'openai' })).toBe(
      'Model · openai · gpt-x',
    );
  });

  it('kombinasi yang penyedianya hanya mengulang jenis: tanpa penyedia', () => {
    expect(modelFacts({ id: 'coding-main', kind: 'combo', ownedBy: 'combo' })).toBe(
      'Kombinasi · coding-main',
    );
  });

  it('penyedia kosong dilewati', () => {
    expect(modelFacts({ id: 'x', kind: 'model', ownedBy: '' })).toBe('Model · x');
  });
});
