import { RICH_ANSWER_LIMITS, RichAnswerSchema, type RichAnswer } from '@aios/contracts';

export type RichAnswerParseResult =
  | { kind: 'valid'; value: RichAnswer }
  | { kind: 'invalid' };

export function parseRichAnswer(code: string): RichAnswerParseResult {
  if (new TextEncoder().encode(code).byteLength > RICH_ANSWER_LIMITS.maxJsonBytes) return { kind: 'invalid' };
  try {
    const parsed = RichAnswerSchema.safeParse(JSON.parse(code) as unknown);
    return parsed.success ? { kind: 'valid', value: parsed.data } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}
