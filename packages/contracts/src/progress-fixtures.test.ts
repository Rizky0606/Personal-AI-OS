import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConversationProgressSchema } from './api-schemas.js';
import { AgentEventSchema } from './events.js';

/**
 * Fixture emas panel Progres (fixtures/progress) dipakai desktop (P2B) dan Android (P6). Di sini hanya bentuknya
 * yang divalidasi terhadap kontrak; perilaku `buildProgress` diuji di apps/desktop (progressFixtures.test.ts).
 */
const DIR = fileURLToPath(new URL('../fixtures/progress/', import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

interface Fixture {
  name: string;
  description: string;
  now: string;
  response: unknown;
  runId: string | null;
  events: { seq: number; ts: string; event: unknown }[];
  view: {
    hasPlan: boolean;
    steps: { id: string; label: string; state: string }[];
    chip: { current: number; total: number | null; label: string } | null;
    outputs: unknown[];
    used: Record<string, unknown>;
  };
}

describe('fixtures/progress', () => {
  it('ada fixture', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)('%s: agregat, event, dan view sesuai bentuk kontrak', (file) => {
    const f = JSON.parse(
      readFileSync(new URL(file, `file:///${DIR.replaceAll('\\', '/')}`), 'utf8'),
    ) as Fixture;
    expect(f.name + '.json').toBe(file);
    expect(f.description.length).toBeGreaterThan(20);
    expect(Number.isFinite(Date.parse(f.now))).toBe(true);

    if (f.response !== null)
      expect(() => ConversationProgressSchema.parse(f.response)).not.toThrow();
    let seq = 0;
    for (const e of f.events) {
      expect(e.seq).toBeGreaterThan(seq);
      seq = e.seq;
      expect(Number.isFinite(Date.parse(e.ts))).toBe(true);
      expect(() => AgentEventSchema.parse(e.event)).not.toThrow();
    }

    // View: rencana punya total; tanpa rencana total null dan tidak pernah dikarang.
    expect(f.view.hasPlan).toBe(f.view.steps.length > 0 && f.view.chip?.total !== null);
    if (f.view.chip) {
      expect(f.view.chip.current).toBeGreaterThanOrEqual(1);
      expect(f.view.chip.current).toBeLessThanOrEqual(f.view.steps.length);
      expect(f.view.chip.total).toBe(f.view.hasPlan ? f.view.steps.length : null);
    } else {
      expect(f.view.steps).toEqual([]);
    }
    for (const step of f.view.steps)
      expect(['done', 'active', 'pending', 'blocked', 'abandoned']).toContain(step.state);
    expect(Object.keys(f.view.used).sort()).toEqual(
      ['connectors', 'engine', 'memory', 'model', 'skills', 'tools', 'uploads'].sort(),
    );
  });
});
