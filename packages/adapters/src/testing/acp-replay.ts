import { readFileSync } from 'node:fs';
import { AsyncQueue } from '../queue.js';
import type { AcpTransport } from '../acp/rpc.js';

interface Entry {
  dir: '<' | '>' | '!';
  frame: Record<string, unknown>;
  /** Baris `<` yang bukan JSON dikirim apa adanya (agent yang salah memformat stdout). */
  raw?: string;
}

export interface AcpReplayTransport extends AcpTransport {
  /** Frame yang dikirim klien, berurutan. */
  sent: Record<string, unknown>[];
  /** Ketidaksesuaian dengan transkrip. Kosong bila adapter patuh transkrip. */
  mismatches: string[];
  killed: boolean;
  inputClosed: boolean;
  /** Mematikan proses seolah crash (stdout ditutup). */
  crash(): void;
}

/**
 * Agent ACP palsu yang memutar ulang transkrip. Baris `<` = keluaran agent, `>` = frame yang diharapkan dari
 * klien (dicocokkan lewat `method` atau, untuk respons, `id`), `!` = agent keluar (crash) tanpa keluaran lagi.
 * Keluaran dikirim sampai masukan berikutnya yang diharapkan. `id` request klien pada rekaman dipetakan ke id
 * nyata, jadi respons rekaman cocok. Fixture di `__fixtures__/dsh` berlabel SINTETIS (docs/ADAPTER_ACP.md).
 */
export function acpReplayTransport(fixturePath: string): AcpReplayTransport {
  const entries: Entry[] = readFileSync(fixturePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line): Entry => {
      const dir = line[0] as Entry['dir'];
      const body = line.slice(2);
      try {
        return { dir, frame: body ? (JSON.parse(body) as Record<string, unknown>) : {} };
      } catch {
        return { dir, frame: {}, raw: body };
      }
    });

  const queue = new AsyncQueue<string>();
  const idMap = new Map<unknown, unknown>();
  let index = 0;
  let resolveExit: (value: { code: number | null }) => void = () => undefined;
  const exited = new Promise<{ code: number | null }>((resolve) => (resolveExit = resolve));

  const pump = (): void => {
    for (;;) {
      const entry = entries[index];
      if (!entry || entry.dir === '>') return;
      index++;
      if (entry.dir === '!') {
        crash();
        return;
      }
      if (entry.raw !== undefined) {
        queue.push(entry.raw);
        continue;
      }
      const frame = { ...entry.frame };
      if (!('method' in frame) && idMap.has(frame.id)) frame.id = idMap.get(frame.id);
      queue.push(JSON.stringify(frame));
    }
  };

  const crash = (): void => {
    queue.end();
    resolveExit({ code: 1 });
  };

  const label = (frame: Record<string, unknown>): string =>
    typeof frame.method === 'string' ? frame.method : 'respons';

  const transport: AcpReplayTransport = {
    sent: [],
    mismatches: [],
    killed: false,
    inputClosed: false,
    lines: queue,
    exited,
    crash,
    write(raw) {
      const frame = JSON.parse(raw) as Record<string, unknown>;
      transport.sent.push(frame);
      const expected = entries[index];
      if (expected?.dir !== '>') {
        // Frame yang tidak ada di transkrip (mis. session/cancel tambahan): dicatat, transkrip tidak bergeser.
        transport.mismatches.push(`tak terduga: ${label(frame)}`);
        return;
      }
      const sameMethod = expected.frame.method === frame.method;
      const sameResponse = !('method' in expected.frame) && expected.frame.id === frame.id;
      if (!sameMethod && !sameResponse) {
        transport.mismatches.push(`diharapkan ${label(expected.frame)}, dapat ${label(frame)}`);
        return;
      }
      if (sameMethod && 'id' in expected.frame) idMap.set(expected.frame.id, frame.id);
      if (sameResponse && JSON.stringify(expected.frame.result) !== JSON.stringify(frame.result)) {
        transport.mismatches.push(`respons ${String(frame.id)} berbeda dari rekaman`);
      }
      index++;
      pump();
    },
    closeInput() {
      transport.inputClosed = true;
      crash();
    },
    kill() {
      transport.killed = true;
      crash();
    },
  };
  queueMicrotask(pump);
  return transport;
}
