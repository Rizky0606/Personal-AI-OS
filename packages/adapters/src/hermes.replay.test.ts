import type { AgentEvent } from '@aios/contracts';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHermesAdapter } from './hermes.js';

/**
 * Tes berbasis rekaman Hermes: setiap `packages/adapters/fixtures/hermes/<nama>.sse` adalah tangkapan
 * mentah aliran SSE `POST /v1/chat/completions` (mis. `curl -N`, termasuk event bernama seperti
 * `hermes.tool.progress`). Berkas diputar ke adapter dan event kontrak yang keluar dibandingkan dengan
 * snapshot. Format dan cara merekam: docs/ADAPTER_EVENTS.md.
 *
 * Saat ini folder rekaman Hermes belum ada (belum ada tangkapan nyata), jadi tes ini dilewati dan itu
 * dilaporkan sebagai tes skip, bukan lulus.
 */
const DIR = fileURLToPath(new URL('../fixtures/hermes/', import.meta.url));
const recordings = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.sse')) : [];

const MESSAGE_ID = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN_ID = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8ea0';

async function replay(file: string): Promise<AgentEvent[]> {
  const raw = readFileSync(join(DIR, file));
  const adapter = createHermesAdapter({
    baseUrl: 'http://hermes.test',
    fetch: () =>
      Promise.resolve(
        new Response(raw, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      ),
  });
  const handle = await adapter.startRun({
    runId: RUN_ID,
    messageId: MESSAGE_ID,
    prompt: 'rekaman',
  });
  const events: AgentEvent[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

describe('Hermes: rekaman nyata → event kontrak (snapshot)', () => {
  if (recordings.length === 0) {
    it.skip('belum ada rekaman di packages/adapters/fixtures/hermes (*.sse)', () => undefined);
    return;
  }
  it.each(recordings)('%s', async (file) => {
    expect(await replay(file)).toMatchSnapshot();
  });
});
