import { describe, expect, it } from 'vitest';
import { parseRichAnswer } from './richAnswerParser';

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
      parseRichAnswer(
        '{"version":1,"components":[{"id":"m","type":"metric","label":"A","value":1,"style":"x"}]}',
      ),
    ).toEqual({ kind: 'invalid' });
    expect(parseRichAnswer('x'.repeat(20 * 1024 + 1))).toEqual({ kind: 'invalid' });
  });
});
