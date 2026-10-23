export interface SseMessage {
  /** Nama event (`event:`); kosong untuk event polos. */
  event: string | undefined;
  data: string;
}

/**
 * Parser Server-Sent Events. Baris berawalan `:` (keepalive) dilewati; baris data yang terpotong antar-chunk
 * dirakit ulang; beberapa baris `data:` dalam satu event digabung dengan newline.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event: string | undefined;
  let data: string[] = [];

  const line = function* (raw: string): Generator<SseMessage> {
    if (raw === '') {
      if (data.length > 0) yield { event, data: data.join('\n') };
      event = undefined;
      data = [];
    } else if (raw.startsWith(':')) {
      // komentar / keepalive
    } else {
      const colon = raw.indexOf(':');
      const field = colon === -1 ? raw : raw.slice(0, colon);
      let value = colon === -1 ? '' : raw.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') data.push(value);
      else if (field === 'event') event = value;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf('\n')) !== -1) {
        const raw = pending.slice(0, nl).replace(/\r$/, '');
        pending = pending.slice(nl + 1);
        yield* line(raw);
      }
    }
    pending += decoder.decode();
    if (pending) yield* line(pending.replace(/\r$/, ''));
    // Event terakhir tanpa baris kosong penutup tetap dikirim.
    yield* line('');
  } finally {
    // Membatalkan (bukan sekadar melepas) agar koneksi ditutup bila pemanggil berhenti membaca.
    await reader.cancel().catch(() => undefined);
  }
}
