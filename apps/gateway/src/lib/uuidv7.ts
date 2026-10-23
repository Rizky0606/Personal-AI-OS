import { randomFillSync } from 'node:crypto';

let lastMs = 0;
let counter = 0;

/**
 * UUIDv7 (RFC 9562): 48 bit milidetik, versi 7, 12 bit rand_a, varian 10, 62 bit acak.
 * rand_a dipakai sebagai penghitung monoton agar ID dalam satu milidetik tetap berurutan.
 */
export function uuidv7(now: number = Date.now()): string {
  let ms = Math.max(now, lastMs);
  if (ms === lastMs) {
    counter += 1;
    if (counter > 0xfff) {
      ms += 1;
      counter = 0;
    }
  } else {
    counter = 0;
  }
  lastMs = ms;

  const bytes = new Uint8Array(16);
  randomFillSync(bytes, 6);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(ms / 0x10000));
  view.setUint16(4, ms % 0x10000);
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
