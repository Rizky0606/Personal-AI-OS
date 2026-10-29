import type { AgentEvent } from '@aios/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOmpAdapter } from './omp.js';
import { replayTransport } from './testing/replay.js';
import type { RunHandle } from './types.js';

/**
 * Tes berbasis rekaman: transkrip RPC nyata omp (src/__fixtures__/omp, docs/VERIFICATION.md) diputar ke
 * adapter dan urutan event kontrak yang keluar dibandingkan dengan snapshot (__snapshots__). Snapshot
 * gagal bila pemetaan berubah; perbarui hanya setelah memeriksa bahwa perubahannya disengaja.
 */
const FIXTURES = fileURLToPath(new URL('./__fixtures__/omp/', import.meta.url));
const RUN = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
const MESSAGE = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e91';

let runDir: string;
beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'aios-omp-replay-'));
});
afterEach(async () => {
  await rm(runDir, { recursive: true, force: true });
});

type Reaction = (event: AgentEvent, handle: RunHandle) => Promise<void> | void;

/** Perilaku klien per rekaman, sama dengan yang dilakukan saat rekaman dibuat. */
const SCENARIOS: Record<string, Reaction> = {
  'text-only': () => undefined,
  'model-error': () => undefined,
  'tool-approve': async (event, handle) => {
    if (event.type === 'approval.requested')
      await handle.resolveApproval(event.approvalId, 'allow');
  },
  'tool-deny': async (event, handle) => {
    if (event.type === 'approval.requested') await handle.resolveApproval(event.approvalId, 'deny');
  },
  'write-and-session-approve': async (event, handle) => {
    if (event.type === 'approval.requested') {
      await handle.resolveApproval(event.approvalId, 'allow', event.kind === 'command');
    }
  },
  abort: async (event, handle) => {
    if (event.type === 'message.delta') await handle.cancel();
  },
  // Direkam dengan omp 18.13.2 dan LLM tiruan: penalaran (thinking_*) lalu jawaban.
  thinking: () => undefined,
  // Direkam dengan omp 18.13.2: bash berjalan, izin dijawab Izinkan, lalu dibatalkan (abort) saat tool berjalan.
  'abort-tool': async (event, handle) => {
    if (event.type === 'approval.requested')
      await handle.resolveApproval(event.approvalId, 'allow');
    if (event.type === 'approval.resolved') await handle.cancel();
  },
  // omp 18.13.2: tool `todo` (op init). Kontrak belum punya todo.updated, jadi hanya tool.started/finished.
  todo: () => undefined,
  // omp 18.13.2: tool `task` (subagen) berjalan async; prompt_result completed datang dengan sessionSettled=false.
  'task-subagent': async (event, handle) => {
    if (event.type === 'approval.requested')
      await handle.resolveApproval(event.approvalId, 'allow');
  },
  steer: (() => {
    let steered = false;
    return async (event: AgentEvent, handle: RunHandle) => {
      if (event.type === 'message.delta' && !steered) {
        steered = true;
        await handle.steer('fokus ke tes saja');
      }
    };
  })(),
};

async function replay(fixture: string): Promise<{ events: AgentEvent[]; mismatches: string[] }> {
  const transport = replayTransport(join(FIXTURES, `${fixture}.jsonl`));
  let clock = 1_000;
  let ids = 0;
  const adapter = createOmpAdapter({
    launch: () => transport,
    llm: { baseUrl: 'http://127.0.0.1:4555/v1', apiKey: 'kunci-lokal' },
    // Jam dan ID deterministik: durationMs dan approvalId ikut masuk snapshot.
    now: () => (clock += 100),
    newId: () => `approval-${++ids}`,
    abortGraceMs: 500,
  });
  const handle = await adapter.startRun({
    runId: RUN,
    messageId: MESSAGE,
    prompt: 'kerjakan tugas',
    model: 'mock-1',
    cwd: 'C:\\work\\repo',
    runDir,
  });
  const react = SCENARIOS[fixture]!;
  const events: AgentEvent[] = [];
  for await (const event of handle.events) {
    events.push(event);
    await react(event, handle);
  }
  return { events, mismatches: transport.mismatches };
}

describe('omp: rekaman nyata → event kontrak (snapshot)', () => {
  it.each(Object.keys(SCENARIOS))('%s', async (fixture) => {
    const { events, mismatches } = await replay(fixture);

    expect(mismatches).toEqual([]);
    expect(events).toMatchSnapshot();
  });
});
