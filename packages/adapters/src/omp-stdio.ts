import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { OmpTransport } from './omp.js';

/**
 * Membungkus proses anak (stdin/stdout piped) sebagai transport omp. `kill` diberikan pemanggil supaya
 * seluruh pohon proses bisa dimatikan (di Windows: taskkill /T), bukan hanya proses omp-nya.
 */
export function stdioTransport(
  child: ChildProcessWithoutNullStreams,
  kill: () => void,
): OmpTransport {
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  child.stdin.on('error', () => undefined); // menulis ke proses yang sudah mati bukan kegagalan adapter
  const exited = new Promise<{ code: number | null }>((resolve) => {
    child.once('close', (code) => resolve({ code }));
    child.once('error', () => resolve({ code: null }));
  });
  return {
    write: (frame) => {
      if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(frame);
    },
    lines: reader,
    closeInput: () => {
      if (!child.stdin.destroyed) child.stdin.end();
    },
    kill,
    exited,
  };
}
