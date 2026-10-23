import { readFileSync } from 'node:fs';
import { AsyncQueue } from '../queue.js';
import type { OmpTransport } from '../omp.js';

interface Entry {
  dir: '<' | '>';
  frame: Record<string, unknown>;
}

/** Perintah yang adapter kirim di luar transkrip rekaman; dijawab otomatis tanpa menggeser transkrip. */
const EXTRA_COMMANDS = new Set(['set_auto_retry', 'abort_retry']);

export interface ReplayTransport extends OmpTransport {
  /** Frame yang dikirim adapter, berurutan. */
  sent: Record<string, unknown>[];
  /** Ketidaksesuaian dengan transkrip (tipe/nilai frame tak terduga). Kosong bila adapter patuh transkrip. */
  mismatches: string[];
  killed: boolean;
  inputClosed: boolean;
}

/**
 * Proses omp palsu yang memutar ulang transkrip RPC nyata (docs/VERIFICATION.md, direkam dari omp 18.12.6).
 * Baris `<` adalah keluaran omp, `>` adalah masukan yang diharapkan dari adapter. Keluaran dikirim sampai
 * masukan berikutnya yang diharapkan, lalu menunggu adapter benar-benar mengirimnya (jadi abort, steer,
 * dan jawaban approval terjadi pada titik yang sama seperti di rekaman). ID permintaan adapter dipetakan
 * ke ID rekaman supaya balasan cocok.
 */
export function replayTransport(fixturePath: string): ReplayTransport {
  const entries: Entry[] = readFileSync(fixturePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => ({
      dir: line[0] as '<' | '>',
      frame: JSON.parse(line.slice(2)) as Record<string, unknown>,
    }));

  const queue = new AsyncQueue<string>();
  const idMap = new Map<string, string>();
  let index = 0;
  let resolveExit: (value: { code: number | null }) => void = () => undefined;
  const exited = new Promise<{ code: number | null }>((resolve) => (resolveExit = resolve));

  const transport: ReplayTransport = {
    sent: [],
    mismatches: [],
    killed: false,
    inputClosed: false,
    lines: queue,
    exited,
    write(raw) {
      const frame = JSON.parse(raw) as Record<string, unknown>;
      transport.sent.push(frame);
      const expected = entries[index];
      if (expected?.dir === '>' && expected.frame.type === frame.type) {
        const recordedId = expected.frame.id;
        if (typeof recordedId === 'string' && typeof frame.id === 'string') {
          idMap.set(recordedId, frame.id);
        }
        if (frame.type === 'extension_ui_response' && frame.value !== expected.frame.value) {
          transport.mismatches.push(
            `jawaban approval ${String(frame.value)} != rekaman ${String(expected.frame.value)}`,
          );
        }
        index++;
        pump();
      } else if (typeof frame.type === 'string' && EXTRA_COMMANDS.has(frame.type)) {
        queue.push(
          JSON.stringify({ id: frame.id, type: 'response', command: frame.type, success: true }),
        );
      } else {
        transport.mismatches.push(
          `frame tak terduga ${String(frame.type)} (menunggu ${typeof expected?.frame.type === 'string' ? expected.frame.type : 'akhir'})`,
        );
      }
    },
    closeInput() {
      transport.inputClosed = true;
      queue.end();
      resolveExit({ code: 0 });
    },
    kill() {
      transport.killed = true;
      queue.end();
      resolveExit({ code: null });
    },
  };

  function pump(): void {
    while (entries[index]?.dir === '<') {
      const frame = { ...entries[index]?.frame } as Record<string, unknown>;
      if (typeof frame.id === 'string' && idMap.has(frame.id)) frame.id = idMap.get(frame.id);
      queue.push(JSON.stringify(frame));
      index++;
    }
  }

  pump();
  return transport;
}
