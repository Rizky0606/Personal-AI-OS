import { z } from 'zod';

export const RICH_ANSWER_LIMITS = {
  maxJsonBytes: 20 * 1024,
  maxComponents: 12,
  maxChartPoints: 24,
  maxTableRows: 100,
  maxItems: 20,
  maxLabelLength: 240,
  maxTextLength: 4000,
} as const;

const text = z.string().max(RICH_ANSWER_LIMITS.maxTextLength);
const label = z.string().min(1).max(RICH_ANSWER_LIMITS.maxLabelLength);
const tone = z.enum(['neutral', 'info', 'success', 'warning', 'danger']);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);

const MetricSchema = z
  .object({
    id,
    type: z.literal('metric'),
    label,
    value: z.union([z.number().finite(), text]),
    unit: label.optional(),
    tone: tone.optional(),
    trend: z
      .strictObject({
        value: z.number().finite(),
        direction: z.enum(['up', 'down', 'flat']),
        tone: tone,
      })
      .optional(),
  })
  .strict();

const TableSchema = z
  .object({
    id,
    type: z.literal('table'),
    columns: z.array(label).min(1).max(20),
    rows: z.array(z.array(text).max(20)).max(RICH_ANSWER_LIMITS.maxTableRows),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [index, row] of value.rows.entries()) {
      if (row.length !== value.columns.length) {
        ctx.addIssue({ code: 'custom', path: ['rows', index], message: 'jumlah sel tidak sama dengan kolom' });
      }
    }
  });

const ChartSchema = z
  .object({
    id,
    type: z.literal('chart'),
    chart: z.enum(['bar', 'line']),
    labels: z.array(label).min(1).max(RICH_ANSWER_LIMITS.maxChartPoints),
    values: z.array(z.number().finite()).min(1).max(RICH_ANSWER_LIMITS.maxChartPoints),
    tone: tone.optional(),
    label: label.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.labels.length !== value.values.length) {
      ctx.addIssue({ code: 'custom', path: ['values'], message: 'jumlah nilai tidak sama dengan label' });
    }
  });

const ChecklistSchema = z
  .object({
    id,
    type: z.literal('checklist'),
    label: label.optional(),
    items: z
      .array(z.strictObject({ id, label, checked: z.boolean() }))
      .max(RICH_ANSWER_LIMITS.maxItems),
  })
  .strict();

const ChoicesSchema = z
  .object({
    id,
    type: z.literal('choices'),
    label: label.optional(),
    mode: z.enum(['single', 'multiple']),
    options: z
      .array(z.strictObject({ id, label, description: text.optional() }))
      .min(1)
      .max(RICH_ANSWER_LIMITS.maxItems),
  })
  .strict();

const SliderSchema = z
  .object({
    id,
    type: z.literal('slider'),
    label,
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
    value: z.number().finite(),
    tone: tone.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.max <= value.min) ctx.addIssue({ code: 'custom', path: ['max'], message: 'max harus lebih besar dari min' });
    if (value.value < value.min || value.value > value.max) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'value di luar rentang' });
    }
  });

const CalloutSchema = z
  .object({
    id,
    type: z.literal('callout'),
    tone: z.enum(['info', 'success', 'warning', 'danger']),
    title: label.optional(),
    text,
  })
  .strict();

const StepsSchema = z
  .object({
    id,
    type: z.literal('steps'),
    label: label.optional(),
    items: z
      .array(z.strictObject({ id, title: label, text, done: z.boolean().optional() }))
      .max(RICH_ANSWER_LIMITS.maxItems),
  })
  .strict();

const KvSchema = z
  .object({
    id,
    type: z.literal('kv'),
    items: z
      .array(z.strictObject({ key: label, value: text }))
      .min(1)
      .max(RICH_ANSWER_LIMITS.maxItems),
  })
  .strict();

export const RichComponentSchema = z.discriminatedUnion('type', [
  MetricSchema,
  TableSchema,
  ChartSchema,
  ChecklistSchema,
  ChoicesSchema,
  SliderSchema,
  CalloutSchema,
  StepsSchema,
  KvSchema,
]);
export type RichComponent = z.infer<typeof RichComponentSchema>;

export const RichAnswerSchema = z
  .strictObject({ version: z.literal(1), components: z.array(RichComponentSchema).min(1).max(RICH_ANSWER_LIMITS.maxComponents) })
  .meta({ id: 'RichAnswer' });
export type RichAnswer = z.infer<typeof RichAnswerSchema>;

export const RichAnswerFollowUpSchema = z
  .strictObject({
    blockId: id,
    componentId: id,
    action: z.enum(['choice', 'slider', 'checklist']),
    value: z.union([text, z.array(id).max(RICH_ANSWER_LIMITS.maxItems), z.number().finite(), z.boolean()]),
  })
  .meta({ id: 'RichAnswerFollowUp' });
export type RichAnswerFollowUp = z.infer<typeof RichAnswerFollowUpSchema>;
