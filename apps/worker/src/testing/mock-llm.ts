import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ChatRequest {
  url: string | undefined;
  auth: string | undefined;
  body: {
    model?: string;
    messages: { role: string; content?: unknown; tool_calls?: unknown }[];
    [key: string]: unknown;
  };
}

/** Satu langkah jawaban model tiruan: teks, pemanggilan tool, atau galat HTTP. */
export type MockStep =
  | { text: string; parts?: string[]; partDelayMs?: number; reasoning?: string[] }
  | { tool: { id?: string; name: string; args: Record<string, unknown> } }
  | { status: number };

/**
 * Server chat completions OpenAI-compatible tiruan (streaming SSE) dengan skenario berskrip.
 * `script(n, request)` memilih langkah berikutnya dari jumlah pesan tool di riwayat, jadi aman terhadap
 * percobaan ulang. Dipakai uji end-to-end dengan omp sungguhan.
 */
export function mockLlm(script: (toolResults: number, request: ChatRequest) => MockStep) {
  const requests: ChatRequest[] = [];
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      if (req.url?.includes('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-1', object: 'model' }] }));
        return;
      }
      const body = (raw ? JSON.parse(raw) : { messages: [] }) as ChatRequest['body'];
      const request: ChatRequest = { url: req.url, auth: req.headers.authorization, body };
      requests.push(request);
      const toolResults = body.messages.filter((m) => m.role === 'tool').length;
      const step = script(toolResults, request);
      if ('status' in step) {
        res.writeHead(step.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'boom dari model', type: 'server_error' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: object, finish: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock-1', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
        );
      void (async () => {
        if ('tool' in step) {
          chunk({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                index: 0,
                id: step.tool.id ?? `call_${toolResults + 1}`,
                type: 'function',
                function: { name: step.tool.name, arguments: '' },
              },
            ],
          });
          chunk({
            tool_calls: [{ index: 0, function: { arguments: JSON.stringify(step.tool.args) } }],
          });
          chunk({}, 'tool_calls');
        } else {
          chunk({ role: 'assistant', content: '' });
          // Penalaran gaya OpenAI-compatible (reasoning_content), mis. DeepSeek/Qwen lewat 9Router.
          for (const part of step.reasoning ?? []) chunk({ reasoning_content: part });
          for (const part of step.parts ?? [step.text]) {
            if (res.destroyed) return;
            chunk({ content: part });
            if (step.partDelayMs) await new Promise((r) => setTimeout(r, step.partDelayMs));
          }
          chunk({}, 'stop');
        }
        res.write(
          `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock-1', choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
      })();
    });
  };
  return { handler, requests };
}
