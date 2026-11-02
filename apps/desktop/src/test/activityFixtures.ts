import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AgentEvent } from '@aios/contracts';
import { buildActivity, type Activity } from '../realtime/activity';
import { newLiveRun, reduceLiveRun, withRunStart, type LiveRun } from '../realtime/liveRun';

interface Fixture {
  events: { ts: string; event: AgentEvent }[];
  checkpoints: { note: string; now: string; applied: number; activity: Activity }[];
}

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FIXTURES = resolve(HERE, '../../../../packages/contracts/fixtures/activity');

/** Nama fixture emas aktivitas (tanpa `format-elapsed`, yang bukan skenario run). */
export const FIXTURE_NAMES = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.json') && f !== 'format-elapsed.json')
  .map((f) => f.replace(/\.json$/, ''));

function load(name: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as Fixture;
}

/** Memutar fixture sampai checkpoint (`-1` = terakhir) dan mengembalikan run live serta waktu "sekarang"-nya. */
export function fixtureRun(name: string, checkpoint = -1): { live: LiveRun; now: number } {
  const f = load(name);
  const c = checkpoint < 0 ? f.checkpoints.at(-1)! : f.checkpoints[checkpoint]!;
  let live = newLiveRun(name);
  for (const e of f.events.slice(0, c.applied))
    live = reduceLiveRun(live, e.event, Date.parse(e.ts));
  const now = Date.parse(c.now);
  return { live: withRunStart(live, now), now };
}

export function fixtureActivity(name: string, checkpoint = -1): Activity {
  const { live, now } = fixtureRun(name, checkpoint);
  return buildActivity(live, now);
}

/** Semua checkpoint semua fixture: kombinasi (nama, indeks, aktivitas) untuk tes parametrik. */
export function allCheckpoints(): { name: string; index: number; activity: Activity }[] {
  return FIXTURE_NAMES.flatMap((name) =>
    load(name).checkpoints.map((_, index) => ({
      name,
      index,
      activity: fixtureActivity(name, index),
    })),
  );
}
