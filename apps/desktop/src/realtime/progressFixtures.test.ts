import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, ConversationProgress } from '@aios/contracts';
import { newLiveRun, reduceLiveRun, withRunStart, type LiveRun } from './liveRun';
import { buildProgress, type ProgressView } from './progress';

/** Fixture emas bersama Android (P6): packages/contracts/fixtures/progress. Diubah hanya dengan sengaja. */
interface Fixture {
  name: string;
  now: string;
  response: ConversationProgress | null;
  runId: string | null;
  events: { seq: number; ts: string; event: AgentEvent }[];
  view: ProgressView;
}

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIR = resolve(HERE, '../../../../packages/contracts/fixtures/progress');
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture);

function liveOf(f: Fixture): LiveRun | undefined {
  if (!f.runId || f.events.length === 0) return undefined;
  let live = newLiveRun(f.runId);
  for (const e of f.events) live = reduceLiveRun(live, e.event, Date.parse(e.ts));
  return withRunStart(live, Date.parse(f.now));
}

describe('buildProgress: fixture emas', () => {
  it('ada fixture untuk rencana tengah jalan, tanpa rencana, muat ulang, dan langkah terhambat', () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual([
      'blocked-and-abandoned',
      'hermes-no-plan',
      'plan-midway',
      'reload-complete',
    ]);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s: keluaran sama persis', (_name, f) => {
    expect(buildProgress(f.response, liveOf(f), Date.parse(f.now))).toEqual(f.view);
  });

  it('murni: dua panggilan berurutan memberi hasil sama dan masukan tidak berubah', () => {
    const f = fixtures.find((x) => x.name === 'plan-midway')!;
    const live = liveOf(f);
    const before = JSON.stringify({ r: f.response, l: live });
    const a = buildProgress(f.response, live, Date.parse(f.now));
    const b = buildProgress(f.response, live, Date.parse(f.now));
    expect(a).toEqual(b);
    expect(JSON.stringify({ r: f.response, l: live })).toBe(before);
  });
});

describe('buildProgress: aturan penggabungan', () => {
  const plan = (statuses: ('completed' | 'in_progress' | 'pending')[]) => [
    {
      name: 'Rencana',
      tasks: statuses.map((status, i) => ({ content: `Langkah ${i + 1}`, status })),
    },
  ];
  const response = (statuses: Parameters<typeof plan>[0]): ConversationProgress => ({
    plan: { runId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e01', phases: plan(statuses) },
    outputs: [],
    used: {
      skills: [],
      engine: null,
      model: null,
      memory: { read: 0, items: [] },
      attachments: [],
      tools: [],
    },
  });

  it('tanpa data apa pun: kosong dan tanpa chip', () => {
    const view = buildProgress(undefined, undefined, 0);
    expect(view.chip).toBeNull();
    expect(view.steps).toEqual([]);
    expect(view.outputs).toEqual([]);
    expect(view.used.tools).toEqual([]);
  });

  it('chip bernomor dari langkah aktif; semua selesai: N dari N; di sela pembaruan: langkah berikutnya', () => {
    const chip = (s: Parameters<typeof plan>[0]) => buildProgress(response(s), undefined, 0).chip;
    expect(chip(['completed', 'completed', 'in_progress', 'pending'])).toEqual({
      current: 3,
      total: 4,
      label: 'Langkah 3',
    });
    expect(chip(['completed', 'completed', 'completed'])).toEqual({
      current: 3,
      total: 3,
      label: 'Langkah 3',
    });
    // Belum ada yang ditandai aktif (jeda antar pembaruan): menunjuk langkah pending pertama.
    expect(chip(['completed', 'pending', 'pending'])).toEqual({
      current: 2,
      total: 3,
      label: 'Langkah 2',
    });
  });

  it('rencana dari run live menggantikan yang tersimpan; tanpa rencana live, yang tersimpan dipakai', () => {
    let live = newLiveRun('0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e02');
    expect(buildProgress(response(['completed', 'pending']), live, 0).chip?.current).toBe(2);
    live = reduceLiveRun(live, { type: 'todo.updated', phases: plan(['completed', 'completed']) });
    expect(buildProgress(response(['completed', 'pending']), live, 0).chip).toMatchObject({
      current: 2,
      total: 2,
    });
  });

  it('mesin tanpa rencana dan tanpa run live: langkah turunan dari langkah tool tersimpan', () => {
    const view = buildProgress(null, undefined, 0, {
      savedTools: [
        { id: 'a', name: 'read_file', target: 'a.ts', status: 'ok', durationMs: 10 },
        { id: 'b', name: 'terminal', target: 'pnpm test', status: 'ok', durationMs: 20 },
      ],
    });
    expect(view.hasPlan).toBe(false);
    expect(view.steps.map((s) => s.state)).toEqual(['done', 'done']);
    expect(view.chip).toMatchObject({ current: 2, total: null });
  });

  it('artifact live yang sudah ada di agregat tidak ganda; yang baru berada paling atas', () => {
    const run = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e03';
    const id = (n: number) => `0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f0${n}`;
    const stored: ConversationProgress = {
      ...response(['completed']),
      outputs: [
        {
          kind: 'image',
          runId: run,
          at: '2025-01-01T00:00:00Z',
          fileId: id(1),
          name: 'a.png',
          mime: 'image/png',
          size: 1,
        },
      ],
    };
    let live = newLiveRun(run);
    for (const n of [1, 2]) {
      live = reduceLiveRun(live, {
        type: 'artifact.created',
        fileId: id(n),
        name: `${n === 1 ? 'a' : 'b'}.png`,
        mime: 'image/png',
        size: 1,
        sha256: 'a'.repeat(64),
        source: 'screenshot',
      });
    }
    const view = buildProgress(stored, live, Date.parse('2025-01-01T00:01:00Z'));
    expect(view.outputs.map((o) => (o.kind === 'image' ? o.name : o.kind))).toEqual([
      'b.png',
      'a.png',
    ]);
  });
});
