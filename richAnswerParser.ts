import {
  RICH_ANSWER_LIMITS,
  RichAnswerSchema,
  type RichAnswer,
} from '@aios/contracts';

export type RichAnswerParseResult =
  | { kind: 'valid'; value: RichAnswer }
  | { kind: 'invalid' };

export function parseRichAnswer(code: string): RichAnswerParseResult {
  if (new TextEncoder().encode(code).byteLength > RICH_ANSWER_LIMITS.maxJsonBytes) {
    return { kind: 'invalid' };
  }
  try {
    const value: unknown = JSON.parse(code);
    const parsed = RichAnswerSchema.safeParse(value);
    return parsed.success ? { kind: 'valid', value: parsed.data } : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

export function richAnswerSkeleton(): { kind: 'skeleton' } {
  return { kind: 'skeleton' };
}
