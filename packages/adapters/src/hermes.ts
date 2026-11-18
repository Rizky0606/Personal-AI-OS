import type { AgentEvent, Usage } from '@aios/contracts';
import { errorEvent, parseUsage, summarize } from './events.js';
import { parseSse } from './sse.js';
import {
  AdapterError,
  type AdapterCapabilities,
  type AgentAdapter,
  type RunHandle,
  type StartRunInput,
} from './types.js';

export interface HermesAdapterOptions {
  /** Mis. `http://127.0.0.1:8642`; path `/v1/...` ditambahkan adapter. */
  baseUrl: string;
  apiKey?: string | undefined;
  /** Nilai `X-Hermes-Session-Key`: cakupan memori jangka panjang, sama untuk semua percakapan pemilik. */
  sessionKey?: string;
  /** Hermes memakai modelnya sendiri kecuali `direct_model_requests` aktif; nilai ini hanya label. */
  model?: string;
  /** Batas menunggu header respons. */
  connectTimeoutMs?: number;
  /** Tanpa byte selama ini dianggap macet (Hermes mengirim keepalive tiap 10 detik). */
  idleTimeoutMs?: number;
  fetch?: typeof fetch;
  /** Jam untuk durasi tool (diinjeksi di tes). */
  now?: () => number;
}

export const HERMES_DEFAULT_MODEL = 'hermes-agent';

/** Dibuktikan oleh dokumentasi Hermes; streaming ada, sisanya lewat jalur /v1/runs yang belum dipakai. */
const CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  approvals: false,
  steer: false,
  checkpoints: false,
};

type Abort = 'cancelled' | 'connect_timeout' | 'idle_timeout';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const firstString = (...values: unknown[]): string | undefined =>
  values.find((v): v is string => typeof v === 'string' && v !== '');

/**
 * Status di payload `hermes.tool.progress`. Diverifikasi Sesi P5 dengan 4 rekaman nyata (Hermes 0.22.5,
 * VPS, tool `terminal`): payload punya `tool`, `label` (dipakai sebagai target), `toolCallId` (selalu ada,
 * tidak pernah anonim), dan `status` yang HANYA pernah bernilai `running` atau `completed` — tidak pernah
 * `failed`/`error`/`success`/dll, bahkan untuk perintah yang gagal (exit code bukan 0): Hermes tetap
 * mengirim `status: completed` dan menaruh ringkasan galat di teks jawaban, bukan di event tool. Payload
 * `completed` juga TIDAK PERNAH membawa `output`/`result` di rekaman manapun. Nilai `TOOL_FAILED` dan
 * jalur `output`/`result` di bawah karenanya masih **belum terverifikasi rekaman** (dipertahankan untuk
 * kompatibilitas ke depan bila Hermes mengirimnya suatu saat); begitu juga toolCallId anonim (event tanpa
 * ID belum pernah teramati). Lihat docs/ADAPTER_EVENTS.md untuk tabel lengkap.
 */
const TOOL_RUNNING: Record<string, true> = {
  running: true,
  started: true,
  start: true,
  in_progress: true,
};
const TOOL_DONE: Record<string, true> = {
  completed: true,
  complete: true,
  done: true,
  finished: true,
  success: true,
  ok: true,
};
const TOOL_FAILED: Record<string, true> = { error: true, failed: true, failure: true };

function statusError(status: number): AdapterError {
  if (status === 401 || status === 403) {
    return new AdapterError('hermes_auth', 'Hermes menolak API key gateway.');
  }
  if (status === 409) {
    return new AdapterError('hermes_session_conflict', 'Sesi Hermes ini dimiliki permukaan lain.');
  }
  if (status === 429) {
    return new AdapterError('hermes_busy', 'Hermes sedang penuh. Coba lagi sebentar.', true);
  }
  if (status >= 500) {
    return new AdapterError('hermes_unavailable', `Hermes menjawab HTTP ${status}.`, true);
  }
  return new AdapterError('hermes_rejected', `Hermes menolak permintaan (HTTP ${status}).`);
}

/**
 * Adapter Hermes lewat `POST /v1/chat/completions` (stream). Riwayat percakapan dipegang Hermes
 * berdasarkan `X-Hermes-Session-Id`, jadi hanya pesan baru yang dikirim. Memutus koneksi SSE saja TIDAK
 * menghentikan Hermes (diverifikasi Sesi P5: tool tetap berjalan; uji umum v1.2.0: sesi Hermes tetap menyimpan
 * jawaban penuh 8.916 karakter padahal pemilik melihat 404). Karena itu pembatalan dan macet (`idle_timeout`)
 * juga memanggil `POST /v1/runs/{id}/stop` dengan `id` chunk stream (`chatcmpl-…`): diverifikasi pada Hermes VPS
 * 2026-11-18 menjawab 200 `{"status":"stopping"}` dan sesi hanya menyimpan ±420 karakter. Hermes tetap bisa
 * menyimpan sedikit teks sesudah titik putus, jadi gateway juga memulai sesi baru berisi riwayat dari DB pada
 * giliran berikutnya (runner). Lihat docs/ADAPTER_EVENTS.md ("Pembatalan Hermes").
 */
export function createHermesAdapter(options: HermesAdapterOptions): AgentAdapter {
  const {
    apiKey,
    sessionKey = 'owner',
    model = HERMES_DEFAULT_MODEL,
    connectTimeoutMs = 30_000,
    idleTimeoutMs = 60_000,
    fetch: doFetch = fetch,
    now = Date.now,
  } = options;
  const base = options.baseUrl.replace(/\/+$/, '');
  const url = `${base}/v1/chat/completions`;
  const auth: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};

  /** Menghentikan run Hermes di server (tool ikut berhenti). Upaya terbaik: galat dan jawaban diabaikan. */
  async function stopOnServer(completionId: string): Promise<void> {
    try {
      const res = await doFetch(`${base}/v1/runs/${encodeURIComponent(completionId)}/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      });
      await res.body?.cancel().catch(() => undefined);
    } catch {
      // Hermes lama tanpa /v1/runs atau tidak terjangkau: sesi baru di giliran berikutnya tetap menjaga riwayat.
    }
  }

  return {
    id: 'hermes',
    capabilities: () => CAPABILITIES,

    startRun(input: StartRunInput): Promise<RunHandle> {
      const controller = new AbortController();
      let reason: Abort | undefined;
      /** `id` chunk pertama dari Hermes; dipakai untuk menghentikan run di server. */
      let completionId: string | undefined;
      const stop = (why: Abort) => {
        const first = reason === undefined;
        reason ??= why;
        controller.abort();
        if (first && completionId && why !== 'connect_timeout') void stopOnServer(completionId);
      };
      if (input.signal?.aborted) stop('cancelled');
      input.signal?.addEventListener('abort', () => stop('cancelled'), { once: true });

      async function* events(): AsyncGenerator<AgentEvent> {
        if (reason) return;
        type Content =
          | string
          | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
        const messages: { role: string; content: Content }[] = [];
        if (input.systemPrompt) messages.push({ role: 'system', content: input.systemPrompt });
        // Sesi baru setelah percakapan dipotong: Hermes belum punya transkripnya, jadi riwayat dikirim di sini.
        for (const turn of input.history ?? []) messages.push({ ...turn });
        // Gambar dikirim inline sebagai data URL (Hermes menolak upload berkas, tetapi menerima gambar).
        messages.push({
          role: 'user',
          content: input.images?.length
            ? [
                { type: 'text', text: input.prompt },
                ...input.images.map((image) => ({
                  type: 'image_url' as const,
                  image_url: { url: `data:${image.mime};base64,${image.data}` },
                })),
              ]
            : input.prompt,
        });

        const connectTimer = setTimeout(() => stop('connect_timeout'), connectTimeoutMs);
        let res: Response;
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'text/event-stream',
              'x-hermes-session-key': sessionKey,
              ...(input.sessionId ? { 'x-hermes-session-id': input.sessionId } : {}),
              ...auth,
            },
            body: JSON.stringify({
              model: input.model ?? model,
              stream: true,
              stream_options: { include_usage: true },
              messages,
            }),
            signal: controller.signal,
          });
        } catch {
          if (reason === 'cancelled') return;
          yield errorEvent(
            reason === 'connect_timeout'
              ? new AdapterError('hermes_timeout', 'Hermes tidak menjawab tepat waktu.', true)
              : new AdapterError('hermes_unreachable', 'Hermes tidak terjangkau.', true),
          );
          return;
        } finally {
          clearTimeout(connectTimer);
        }

        if (!res.ok || !res.body) {
          await res.body?.cancel().catch(() => undefined);
          yield errorEvent(statusError(res.status));
          return;
        }

        let idleTimer: NodeJS.Timeout | undefined;
        const armIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => stop('idle_timeout'), idleTimeoutMs);
        };

        let text = '';
        let usage: Usage | null = null;
        let finish: string | undefined;
        let failure: string | undefined;
        let done = false;
        // Tool yang sedang berjalan: toolCallId -> waktu mulai. Hermes tidak mengirim durasi, jadi dihitung di sini.
        const openTools = new Map<string, number>();
        let anonymousTools = 0;
        const closeTools = (status: 'ok' | 'error' | 'cancelled'): AgentEvent[] => {
          const closed = [...openTools].map(([toolCallId, startedAt]): AgentEvent => ({
            type: 'tool.finished',
            toolCallId,
            status,
            durationMs: Math.max(0, now() - startedAt),
          }));
          openTools.clear();
          return closed;
        };
        const onToolProgress = (data: string): AgentEvent[] => {
          let payload: unknown;
          try {
            payload = JSON.parse(data);
          } catch {
            return [];
          }
          if (!isRecord(payload)) return [];
          const name = firstString(payload.tool, payload.name);
          const status = firstString(payload.status)?.toLowerCase() ?? 'running';
          const realId = firstString(payload.toolCallId, payload.tool_call_id, payload.id);
          if (TOOL_DONE[status] || TOOL_FAILED[status]) {
            if (!realId || !openTools.has(realId)) return [];
            const startedAt = openTools.get(realId) ?? now();
            openTools.delete(realId);
            const output = firstString(payload.output, payload.result);
            return [
              ...(output
                ? [
                    {
                      type: 'tool.output' as const,
                      toolCallId: realId,
                      chunk: output.length > 8000 ? `${output.slice(0, 7999)}…` : output,
                      stream: 'stdout' as const,
                    },
                  ]
                : []),
              {
                type: 'tool.finished',
                toolCallId: realId,
                status: TOOL_FAILED[status] ? 'error' : 'ok',
                durationMs: Math.max(0, now() - startedAt),
              },
            ];
          }
          if (!TOOL_RUNNING[status] || !name) return [];
          // Tanpa ID dari Hermes (event lama hanya penanda mulai): ID dibuat adapter, unik per run.
          const toolCallId = realId ?? `hermes-tool-${++anonymousTools}`;
          if (openTools.has(toolCallId)) return []; // pembaruan progres untuk panggilan yang sama
          openTools.set(toolCallId, now());
          const target = firstString(payload.target, payload.label, payload.preview);
          return [{ type: 'tool.started', toolCallId, name, ...(target ? { target } : {}) }];
        };
        try {
          armIdle();
          for await (const msg of parseSse(res.body)) {
            armIdle();
            // Event bernama: hanya hermes.tool.progress yang dipetakan; yang lain dilewati tanpa efek.
            if (msg.event && msg.event !== 'message') {
              if (msg.event === 'hermes.tool.progress') yield* onToolProgress(msg.data);
              continue;
            }
            if (msg.data === '[DONE]') {
              done = true;
              break;
            }
            let chunk: unknown;
            try {
              chunk = JSON.parse(msg.data);
            } catch {
              continue;
            }
            if (!isRecord(chunk)) continue;
            if (!completionId && typeof chunk.id === 'string' && chunk.id) completionId = chunk.id;
            if (isRecord(chunk.error) && typeof chunk.error.message === 'string') {
              failure = chunk.error.message;
            }
            usage = parseUsage(chunk.usage) ?? usage;
            const choice = Array.isArray(chunk.choices) ? (chunk.choices[0] as unknown) : undefined;
            if (!isRecord(choice)) continue;
            if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
            const delta = choice.delta;
            if (!isRecord(delta)) continue;
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
              yield {
                type: 'reasoning.delta',
                messageId: input.messageId,
                text: delta.reasoning_content,
              };
            }
            if (typeof delta.content === 'string' && delta.content) {
              text += delta.content;
              yield { type: 'message.delta', messageId: input.messageId, text: delta.content };
            }
          }
        } catch {
          if (reason === 'cancelled') {
            yield* closeTools('cancelled');
            return;
          }
          yield* closeTools('error');
          yield errorEvent(
            reason === 'idle_timeout'
              ? new AdapterError('hermes_stalled', 'Hermes berhenti mengirim data.', true)
              : new AdapterError('hermes_stream_broken', 'Koneksi ke Hermes terputus.', true),
          );
          return;
        } finally {
          clearTimeout(idleTimer);
        }
        if (reason === 'cancelled') {
          yield* closeTools('cancelled');
          return;
        }
        if (finish === 'error' || failure || finish === 'cancelled' || (!finish && !done)) {
          yield* closeTools('error');
        }

        if (finish === 'error' || failure) {
          // Pesan dari Hermes (mis. admission_conflict) hanya kode pendek, bukan isi percakapan.
          yield errorEvent(
            new AdapterError('hermes_error', `Hermes melaporkan kegagalan: ${failure ?? 'error'}.`),
          );
          return;
        }
        if (finish === 'cancelled') {
          yield errorEvent(new AdapterError('hermes_cancelled', 'Hermes menghentikan jawaban.'));
          return;
        }
        if (!finish && !done) {
          yield errorEvent(
            new AdapterError('hermes_stream_truncated', 'Jawaban Hermes terputus.', true),
          );
          return;
        }

        yield* closeTools('ok');
        yield {
          type: 'message.completed',
          messageId: input.messageId,
          ...(usage ? { usage } : {}),
        };
        yield { type: 'run.completed', summary: summarize(text), ...(usage ? { usage } : {}) };
      }

      const unsupported = (what: string) =>
        Promise.reject(
          new AdapterError('unsupported', `Hermes (chat umum) belum mendukung ${what}.`),
        );

      return Promise.resolve({
        runId: input.runId,
        events: events(),
        steer: () => unsupported('steer'),
        removeQueued: () => unsupported('queue'),
        resolveApproval: () => unsupported('approval'),
        answerQuestion: () => unsupported('question'),
        cancel: () => {
          stop('cancelled');
          return Promise.resolve();
        },
      });
    },
  };
}
