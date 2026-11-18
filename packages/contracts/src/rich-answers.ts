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
        ctx.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: 'jumlah sel tidak sama dengan kolom',
        });
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
      ctx.addIssue({
        code: 'custom',
        path: ['values'],
        message: 'jumlah nilai tidak sama dengan label',
      });
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
    if (value.max <= value.min)
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'max harus lebih besar dari min' });
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
  .strictObject({
    version: z.literal(1),
    components: z.array(RichComponentSchema).min(1).max(RICH_ANSWER_LIMITS.maxComponents),
  })
  .meta({ id: 'RichAnswer' });
export type RichAnswer = z.infer<typeof RichAnswerSchema>;

export const RichAnswerFollowUpSchema = z
  .strictObject({
    blockId: id,
    componentId: id,
    action: z.enum(['choice', 'slider', 'checklist']),
    value: z.union([
      text,
      z.array(id).max(RICH_ANSWER_LIMITS.maxItems),
      z.number().finite(),
      z.boolean(),
    ]),
  })
  .meta({ id: 'RichAnswerFollowUp' });
export type RichAnswerFollowUp = z.infer<typeof RichAnswerFollowUpSchema>;

/** Field yang dikenal per jenis komponen; field lain dibuang saat perbaikan (mis. `max` di grafik). */
const COMPONENT_KEYS: Record<RichComponent['type'], readonly string[]> = {
  metric: ['id', 'type', 'label', 'value', 'unit', 'tone', 'trend'],
  table: ['id', 'type', 'columns', 'rows'],
  chart: ['id', 'type', 'chart', 'labels', 'values', 'tone', 'label'],
  checklist: ['id', 'type', 'label', 'items'],
  choices: ['id', 'type', 'label', 'mode', 'options'],
  slider: ['id', 'type', 'label', 'min', 'max', 'step', 'value', 'tone'],
  callout: ['id', 'type', 'tone', 'title', 'text'],
  steps: ['id', 'type', 'label', 'items'],
  kv: ['id', 'type', 'items'],
};

/** Nama lain yang sering ditulis model untuk satu field, per jenis komponen (alias -> nama skema). */
const COMPONENT_ALIASES: Partial<Record<RichComponent['type'], Record<string, string>>> = {
  chart: {
    chartType: 'chart',
    chart_type: 'chart',
    kind: 'chart',
    variant: 'chart',
    title: 'label',
    categories: 'labels',
    xLabels: 'labels',
    x: 'labels',
    data: 'values',
    series: 'values',
    y: 'values',
  },
  table: { headers: 'columns', header: 'columns', head: 'columns', data: 'rows', body: 'rows' },
  metric: { title: 'label', name: 'label' },
  checklist: { title: 'label' },
  choices: { title: 'label', choices: 'options', items: 'options' },
  slider: { title: 'label' },
  steps: { title: 'label', steps: 'items' },
  callout: { label: 'title', body: 'text', content: 'text', variant: 'tone' },
  kv: { pairs: 'items', rows: 'items' },
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Angka yang ditulis sebagai teks ("7", "7,5") menjadi angka; selain itu dibiarkan. */
const toNumber = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const n = Number(v.trim().replace(',', '.'));
  return v.trim() !== '' && Number.isFinite(n) ? n : v;
};

function repairComponent(raw: unknown, index: number): unknown {
  if (!isPlainObject(raw) || typeof raw.type !== 'string' || !(raw.type in COMPONENT_KEYS)) {
    return raw;
  }
  const type = raw.type as RichComponent['type'];
  const aliases = COMPONENT_ALIASES[type] ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = COMPONENT_KEYS[type].includes(key) ? key : aliases[key];
    // Field asli menang atas alias bila keduanya ada.
    if (name && !(name in out && name === aliases[key])) out[name] = value;
  }
  if (typeof out.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(out.id)) {
    out.id = `komponen-${index + 1}`;
  }
  if (type === 'chart') {
    if (typeof out.chart === 'string') {
      const kind = out.chart.toLowerCase();
      out.chart = kind === 'column' || kind === 'bars' ? 'bar' : kind === 'area' ? 'line' : kind;
    }
    out.chart ??= 'bar';
    // `data: [{label, value}]` menjadi dua deret.
    if (Array.isArray(out.values) && out.values.every(isPlainObject) && out.labels === undefined) {
      const points = out.values;
      out.labels = points.map((p) => String(p.label ?? p.name ?? p.x ?? ''));
      out.values = points.map((p) => toNumber(p.value ?? p.y));
    }
    if (Array.isArray(out.values)) out.values = out.values.map(toNumber);
    if (Array.isArray(out.labels)) out.labels = out.labels.map((l) => String(l));
  }
  if (type === 'table' && Array.isArray(out.rows)) {
    out.rows = out.rows.map((row) =>
      Array.isArray(row)
        ? row.map((cell) => (typeof cell === 'string' ? cell : String(cell)))
        : row,
    );
  }
  if (type === 'metric' && typeof out.value === 'string') out.value = toNumber(out.value);
  if (type === 'slider') {
    for (const key of ['min', 'max', 'step', 'value']) out[key] = toNumber(out[key]);
  }
  return out;
}

/**
 * Perbaikan longgar untuk isi blok `aios-ui` yang ditulis model: alias umum (`chartType` -> `chart`, `headers` ->
 * `columns`), field tak dikenal dibuang, angka berupa teks diubah, `id` dan `version` yang hilang dilengkapi. Hasil
 * hanya dipakai bila lolos `RichAnswerSchema` (yang tetap ketat); bila tidak, `null`.
 */
export function repairRichAnswer(raw: unknown): RichAnswer | null {
  const strict = RichAnswerSchema.safeParse(raw);
  if (strict.success) return strict.data;
  if (!isPlainObject(raw)) return null;
  const list = Array.isArray(raw.components)
    ? raw.components
    : isPlainObject(raw.component)
      ? [raw.component]
      : typeof raw.type === 'string'
        ? [raw]
        : null;
  if (!list) return null;
  const repaired = RichAnswerSchema.safeParse({
    version: 1,
    components: list.map(repairComponent),
  });
  return repaired.success ? repaired.data : null;
}

const AIOS_UI_FENCE =
  /(^|\n)([ \t]*)(`{3,}|~{3,})aios-ui[ \t]*\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g;

/**
 * Menulis ulang setiap blok `aios-ui` yang tidak valid tetapi bisa diperbaiki (`repairRichAnswer`) menjadi JSON yang
 * valid. Blok yang sudah valid, terlalu besar, bukan JSON, atau tetap tidak valid dibiarkan apa adanya (klien
 * menampilkan fallback). Dipakai gateway saat jawaban selesai, sebelum disimpan.
 */
export function repairRichAnswerBlocks(text: string): string {
  if (!text.includes('aios-ui')) return text;
  return text.replace(
    AIOS_UI_FENCE,
    (whole: string, start: string, indent: string, fence: string, body: string) => {
      if (new TextEncoder().encode(body).byteLength > RICH_ANSWER_LIMITS.maxJsonBytes) return whole;
      let parsed: unknown;
      try {
        parsed = JSON.parse(body) as unknown;
      } catch {
        return whole;
      }
      if (RichAnswerSchema.safeParse(parsed).success) return whole;
      const repaired = repairRichAnswer(parsed);
      return repaired
        ? `${start}${indent}${fence}aios-ui\n${JSON.stringify(repaired)}\n${indent}${fence}`
        : whole;
    },
  );
}
