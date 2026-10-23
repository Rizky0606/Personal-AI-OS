import type { IncomingMessage, ServerResponse } from 'node:http';
import { startMockServer, type MockServer } from './mock-server.js';

/** Satu respons streaming dari Hermes tiruan; tes mengatur kapan potongan dikirim. */
export interface FakeStream {
  /** Header SSE sudah dikirim. */
  delta(text: string): void;
  reasoning(text: string): void;
  usage(promptTokens: number, completionTokens: number): void;
  finish(reason?: string): void;
  done(): void;
  /** Mengakhiri koneksi tanpa [DONE]. */
  end(): void;
  /** Resolve saat gateway memutus koneksi. */
  closed: Promise<void>;
}

export interface HermesRequest {
  headers: IncomingMessage['headers'];
  body: { messages: { role: string; content: string }[]; model?: string; stream?: boolean };
}

export interface FakeHermes extends Pick<MockServer, 'url' | 'close'> {
  requests: HermesRequest[];
  /** Menentukan perilaku untuk request berikutnya (default: HTTP 500). */
  onRequest: (
    handler: (stream: FakeStream, req: HermesRequest, res: ServerResponse) => void | Promise<void>,
  ) => void;
}

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

export async function startFakeHermes(): Promise<FakeHermes> {
  let handler: Parameters<FakeHermes['onRequest']>[0] = (_s, _r, res) => {
    res.writeHead(500).end();
  };
  const requests: HermesRequest[] = [];

  const server = await startMockServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      const parsed: HermesRequest = {
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as HermesRequest['body']) : { messages: [] },
      };
      requests.push(parsed);
      let signalClosed!: () => void;
      const closed = new Promise<void>((r) => (signalClosed = r));
      res.on('close', signalClosed);
      let started = false;
      const head = () => {
        if (started) return;
        started = true;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      };
      const stream: FakeStream = {
        delta: (text) => {
          head();
          res.write(
            sse({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }),
          );
        },
        reasoning: (text) => {
          head();
          res.write(sse({ choices: [{ index: 0, delta: { reasoning_content: text } }] }));
        },
        usage: (p, c) => {
          head();
          res.write(sse({ choices: [], usage: { prompt_tokens: p, completion_tokens: c } }));
        },
        finish: (reason = 'stop') => {
          head();
          res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }));
        },
        done: () => {
          head();
          res.end('data: [DONE]\n\n');
        },
        end: () => {
          head();
          res.end();
        },
        closed,
      };
      void Promise.resolve(handler(stream, parsed, res));
    });
  });

  return {
    url: server.url,
    close: () => server.close(),
    requests,
    onRequest: (h) => {
      handler = h;
    },
  };
}
