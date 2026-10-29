import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentEventSchema } from './events.js';

/**
 * Fixture emas aktivitas run (fixtures/activity) dipakai desktop (sesi 3) dan Android (sesi 8). Di sini hanya
 * bentuknya yang dijaga: event harus lolos kontrak, urutan dan waktu masuk akal, dan keluaran yang diharapkan
 * lengkap. Kebenaran isinya dijaga tes klien yang memutar ulang fixture.
 */
const DIR = fileURLToPath(new URL('../fixtures/activity/', import.meta.url));
const Iso = z.iso.datetime();

const StepSchema = z.object({
  id: z.string(),
  label: z.string(),
  target: z.string().optional(),
  status: z.enum(['running', 'ok', 'error', 'denied', 'cancelled']),
  durationMs: z.number().nullable(),
  startedAt: z.number().nullable(),
});

const ActivitySchema = z.object({
  headline: z.string().nullable(),
  phase: z.enum([
    'idle',
    'thinking',
    'tool',
    'writing',
    'waiting_approval',
    'done',
    'error',
    'cancelled',
  ]),
  current: z
    .object({
      label: z.string(),
      target: z.string().optional(),
      parallel: z.number().int().positive(),
    })
    .nullable(),
  stepCount: z.number().int().nonnegative(),
  hiddenCount: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
  steps: z.array(StepSchema),
  summary: z.string().nullable(),
  needsAttention: z.boolean(),
});

const FixtureSchema = z.object({
  name: z.string(),
  description: z.string(),
  runId: z.uuid(),
  runCreatedAt: Iso.optional(),
  visibleSteps: z.number().int().positive(),
  events: z.array(z.object({ seq: z.number().int().positive(), ts: Iso, event: AgentEventSchema })),
  checkpoints: z
    .array(
      z.object({
        note: z.string(),
        applied: z.number().int().nonnegative(),
        now: Iso,
        activity: ActivitySchema,
      }),
    )
    .min(1),
});

const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'format-elapsed.json');

describe('fixtures/activity', () => {
  it('berisi skenario minimal sesi 3', () => {
    expect(files.map((f) => f.replace('.json', '')).sort()).toEqual(
      expect.arrayContaining([
        'short-no-tools',
        'fourteen-tools',
        'parallel-tools',
        'tool-error-mid',
        'waiting-approval',
        'cancelled',
        'hermes-no-reasoning',
        'reload-mid-run',
      ]),
    );
  });

  it.each(files)('%s: event lolos kontrak, berurutan, checkpoint konsisten', (file) => {
    const fixture = FixtureSchema.parse(JSON.parse(readFileSync(join(DIR, file), 'utf8')));

    expect(fixture.name).toBe(file.replace('.json', ''));
    expect(fixture.events.map((e) => e.seq)).toEqual(fixture.events.map((_, i) => i + 1));
    const times = fixture.events.map((e) => Date.parse(e.ts));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    for (const checkpoint of fixture.checkpoints) {
      expect(checkpoint.applied).toBeLessThanOrEqual(fixture.events.length);
      // "now" tidak boleh lebih awal dari event terakhir yang sudah diterapkan.
      const last = times[checkpoint.applied - 1];
      if (last !== undefined) expect(Date.parse(checkpoint.now)).toBeGreaterThanOrEqual(last);
      expect(checkpoint.activity.stepCount).toBe(checkpoint.activity.steps.length);
      expect(checkpoint.activity.hiddenCount).toBe(
        Math.max(0, checkpoint.activity.stepCount - fixture.visibleSteps),
      );
    }
  });

  it('format-elapsed.json berisi pasangan ms dan teks', () => {
    const { cases } = z
      .object({ cases: z.array(z.object({ ms: z.number(), text: z.string() })) })
      .parse(JSON.parse(readFileSync(join(DIR, 'format-elapsed.json'), 'utf8')));
    expect(cases.length).toBeGreaterThan(10);
  });
});
