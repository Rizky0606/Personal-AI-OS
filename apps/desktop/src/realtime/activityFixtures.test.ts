import type { AgentEvent } from '@aios/contracts';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildActivity, formatElapsed, type Activity } from './activity';
import { isSettled, newLiveRun, reduceLiveRun, withRunStart, type LiveRun } from './liveRun';

/**
 * Fixture emas bersama (packages/contracts/fixtures/activity): urutan event mentah + keluaran buildActivity
 * yang diharapkan pada beberapa titik waktu. Android memakai berkas yang sama. Mengubah perilaku
 * buildActivity berarti mengubah fixture ini dengan sengaja.
 */
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIR = resolve(HERE, '../../../../packages/contracts/fixtures/activity');

interface Envelope {
  seq: number;
  ts: string;
  event: AgentEvent;
}
interface Fixture {
  name: string;
  runId: string;
  runCreatedAt?: string;
  visibleSteps: number;
  events: Envelope[];
  checkpoints: { note: string; applied: number; now: string; activity: Activity }[];
}

const fixtures: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'format-elapsed.json')
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture);

function replay(fixture: Fixture, events: Envelope[]): LiveRun {
  let live = newLiveRun(fixture.runId);
  if (fixture.runCreatedAt) live = withRunStart(live, Date.parse(fixture.runCreatedAt));
  for (const e of events) live = reduceLiveRun(live, e.event, Date.parse(e.ts));
  return live;
}

describe('fixture emas aktivitas', () => {
  it('memuat skenario minimal', () => {
    expect(fixtures.map((f) => f.name)).toEqual([
      'cancelled',
      'fourteen-tools',
      'hermes-no-reasoning',
      'out-of-order-tool',
      'parallel-tools',
      'reload-mid-run',
      'short-no-tools',
      'tool-error-mid',
      'waiting-approval',
    ]);
  });

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      it.each(fixture.checkpoints.map((c) => [c.note, c] as const))('%s', (_note, checkpoint) => {
        const live = replay(fixture, fixture.events.slice(0, checkpoint.applied));
        const actual = buildActivity(live, Date.parse(checkpoint.now), {
          visibleSteps: fixture.visibleSteps,
        });
        expect(actual).toEqual(checkpoint.activity);
      });
    });
  }

  it('formatElapsed sesuai kasus emas', () => {
    const { cases } = JSON.parse(readFileSync(join(DIR, 'format-elapsed.json'), 'utf8')) as {
      cases: { ms: number; text: string }[];
    };
    expect(cases.length).toBeGreaterThan(10);
    for (const c of cases) expect(formatElapsed(c.ms), `${c.ms}`).toBe(c.text);
  });
});

/** Pengacak deterministik (mulberry32) agar tes properti dapat diulang. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sifat buildActivity pada semua fixture', () => {
  const probes = (fixture: Fixture) => {
    const times = fixture.events.map((e) => Date.parse(e.ts));
    const start = Math.min(...times);
    const end = Math.max(...times);
    return [start - 600_000, start - 1, start, (start + end) / 2, end, end + 1, end + 3_600_000, 0];
  };

  it('elapsedMs tidak pernah negatif, di titik mana pun dan untuk now sembarang', () => {
    for (const fixture of fixtures) {
      for (let applied = 0; applied <= fixture.events.length; applied++) {
        const live = replay(fixture, fixture.events.slice(0, applied));
        for (const now of probes(fixture)) {
          const a = buildActivity(live, now);
          expect(a.elapsedMs, `${fixture.name} @${applied} now=${now}`).toBeGreaterThanOrEqual(0);
          for (const step of a.steps) {
            if (step.durationMs !== null) expect(step.durationMs).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('elapsedMs tidak berubah lagi setelah status terminal, berapa pun now', () => {
    for (const fixture of fixtures) {
      const live = replay(fixture, fixture.events);
      if (!isSettled(live.status)) continue;
      const base = buildActivity(live, Date.parse(fixture.events.at(-1)!.ts));
      for (const later of [1, 1000, 60_000, 86_400_000]) {
        const a = buildActivity(live, Date.parse(fixture.events.at(-1)!.ts) + later);
        expect(a.elapsedMs, fixture.name).toBe(base.elapsedMs);
        expect(a.summary, fixture.name).toBe(base.summary);
      }
    }
  });

  it('tidak kehilangan tool saat event datang tidak berurutan (urutan diacak, banyak kali)', () => {
    const random = rng(2026);
    for (const fixture of fixtures) {
      const toolIds = new Set(
        fixture.events.flatMap((e) =>
          e.event.type === 'tool.started' || e.event.type === 'tool.finished'
            ? [e.event.toolCallId]
            : [],
        ),
      );
      for (let round = 0; round < 25; round++) {
        const shuffled = [...fixture.events]
          .map((e) => ({ e, k: random() }))
          .sort((a, b) => a.k - b.k)
          .map((x) => x.e);
        const live = replay(fixture, shuffled);
        const a = buildActivity(live, Date.parse(fixture.events.at(-1)!.ts));
        expect(new Set(a.steps.map((s) => s.id)), fixture.name).toEqual(toolIds);
        expect(a.steps, `${fixture.name}: tanpa duplikat`).toHaveLength(toolIds.size);
        // Status akhir sebuah tool selalu yang dari tool.finished bila ada, bukan "running" lagi.
        for (const e of fixture.events) {
          if (e.event.type !== 'tool.finished') continue;
          const step = a.steps.find((s) => s.id === (e.event as { toolCallId: string }).toolCallId);
          expect(step?.status, fixture.name).toBe(e.event.status);
        }
      }
    }
  });

  it('tidak melempar untuk LiveRun kosong dan now yang aneh', () => {
    for (const now of [0, -1, 1e15, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildActivity(newLiveRun('kosong'), now)).not.toThrow();
    }
    const a = buildActivity(newLiveRun('kosong'), Number.NaN);
    expect(a.elapsedMs).toBe(0);
    expect(Number.isNaN(a.elapsedMs)).toBe(false);
  });
});
