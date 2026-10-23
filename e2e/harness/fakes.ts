import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { startFakeHermes } from '../../apps/gateway/src/testing/fake-hermes.js';
import { startMockServer, type MockServer } from '../../apps/gateway/src/testing/mock-server.js';
import {
  articleHtml,
  classify,
  scriptedLlmReply,
} from '../../apps/gateway/src/testing/research-fakes.js';
import { mockLlm } from '../../apps/worker/src/testing/mock-llm.js';

/**
 * Layanan eksternal palsu untuk E2E: Hermes (jawaban chat mengalir), 9Router (router role, judul, jadwal,
 * pemecah kartu, riset, dan model coding berskrip), SearXNG, dan halaman web sumber riset.
 */
export interface Fakes {
  hermesUrl: string;
  ninerouterUrl: string;
  searxngUrl: string;
  /** Teks yang dikirim Hermes (untuk memastikan streaming sungguhan terjadi). */
  hermesAnswer: string;
  close(): Promise<void>;
}

export const HERMES_PARTS = ['Halo! ', 'Ini jawaban ', 'streaming dari ', 'Hermes uji.'];
export const CODING_FILE = 'catatan-e2e.txt';
export const CODING_COMMIT = 'docs: tambah catatan e2e';

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const json = (res: ServerResponse, value: unknown) =>
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));

const completion = (content: string) => ({
  choices: [{ index: 0, message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 12, completion_tokens: 7 },
});

interface ChatBody {
  model?: string;
  tools?: unknown[];
  messages: { role: string; content?: unknown }[];
}

const textOf = (content: unknown) => (typeof content === 'string' ? content : '');

export async function startFakes(): Promise<Fakes> {
  const hermes = await startFakeHermes();
  hermes.onRequest(async (stream) => {
    for (const part of HERMES_PARTS) {
      stream.delta(part);
      await sleep(180);
    }
    stream.usage(20, 12);
    stream.finish();
    stream.done();
  });

  const web = await startMockServer((req, res) => {
    const n = Number(/artikel-(\d+)/.exec(req.url ?? '')?.[1]);
    if (!Number.isFinite(n)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(articleHtml(`Sumber ${n} tentang kendaraan listrik`, { published: '2026-01-15' }));
  });

  const searx = await startMockServer((req, res) => {
    if (req.url?.startsWith('/healthz')) return void res.writeHead(200).end('OK');
    const results = Array.from({ length: 8 }, (_, i) => ({
      url: `${web.url}/artikel-${i + 1}`,
      title: `Sumber ${i + 1}`,
      content: 'cuplikan',
      engine: 'fake',
    }));
    json(res, { results });
  });

  // Model coding berskrip: tulis satu berkas, lalu tutup dengan baris Commit (diminta worker lewat prompt sistem).
  const coding = mockLlm((toolResults) =>
    toolResults === 0
      ? { tool: { name: 'write', args: { path: CODING_FILE, content: 'dibuat oleh agent E2E\n' } } }
      : { text: `Catatan sudah ditambahkan.\nCommit: ${CODING_COMMIT}` },
  );

  const nine: MockServer = await startMockServer((req, res) => {
    if (req.url?.includes('/models')) {
      return json(res, {
        object: 'list',
        data: [
          { id: 'router-fast', object: 'model', owned_by: 'combo' },
          { id: 'coding-main', object: 'model', owned_by: 'combo' },
          { id: 'general-cheap', object: 'model', owned_by: 'combo' },
        ],
      });
    }
    void (async () => {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as ChatBody;
      // Permintaan omp (punya tools) memakai skrip coding yang mengalir lewat SSE.
      if ((body.tools?.length ?? 0) > 0) {
        const replay = new (await import('node:stream')).PassThrough();
        replay.end(raw);
        Object.assign(replay, { url: req.url, headers: req.headers, method: req.method });
        return coding.handler(replay as unknown as IncomingMessage, res);
      }
      const system = textOf(body.messages.find((m) => m.role === 'system')?.content);
      const user = textOf(body.messages.findLast((m) => m.role === 'user')?.content);

      if (system.includes('Kamu router')) {
        const coding = /catatan|tombol|kode|file/i.test(user);
        return json(
          res,
          completion(
            JSON.stringify({
              role: coding ? 'frontend' : 'general',
              confidence: 0.92,
              reason: 'Dipilih oleh router uji.',
              needs_split: false,
              subtasks: [],
            }),
          ),
        );
      }
      if (system.includes('pengurai jadwal')) {
        return json(
          res,
          completion(
            JSON.stringify({
              name: 'Ringkasan berita AI',
              cron: '0 7 * * 1',
              timezone: 'Asia/Jakarta',
              prompt: 'Ringkas berita AI minggu ini.',
              target: 'chat',
              agent_role: null,
              error: null,
            }),
          ),
        );
      }
      if (system.includes('perencana tugas coding')) {
        return json(
          res,
          completion(
            JSON.stringify({
              items: [
                { title: 'Buat halaman login', body: 'Form email dan sandi', role: 'frontend' },
                { title: 'Endpoint login', body: '', role: 'backend' },
                { title: 'Tulis catatan rilis', body: '', role: null },
              ],
            }),
          ),
        );
      }
      const request = { model: body.model ?? '', system, user };
      const kind = classify(request);
      if (
        system.includes('perencana riset') ||
        system.includes('peringkas sumber') ||
        kind !== 'synthesis' ||
        user.includes('Sumber:')
      ) {
        return json(res, completion(scriptedLlmReply(request)));
      }
      return json(res, completion('Judul uji'));
    })();
  });

  return {
    hermesUrl: hermes.url,
    ninerouterUrl: nine.url,
    searxngUrl: searx.url,
    hermesAnswer: HERMES_PARTS.join(''),
    async close() {
      await Promise.all([hermes.close(), web.close(), searx.close(), nine.close()]);
    },
  };
}
