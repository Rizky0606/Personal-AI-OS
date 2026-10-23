import { SignJWT, importPKCS8 } from 'jose';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** File service account Firebase (`secrets/`, tidak pernah masuk image atau repo). Hanya field ini yang dipakai. */
export const ServiceAccountSchema = z.looseObject({
  project_id: z.string().min(1),
  client_email: z.string().min(3),
  private_key: z.string().min(1),
  token_uri: z.string().default('https://oauth2.googleapis.com/token'),
});
export type ServiceAccount = z.infer<typeof ServiceAccountSchema>;

export class FcmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FcmConfigError';
  }
}

/** Membaca service account. Pesan error tidak pernah memuat isi file (ada kunci privat di dalamnya). */
export function loadServiceAccount(path: string): ServiceAccount {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new FcmConfigError(`FCM_SERVICE_ACCOUNT_FILE tidak bisa dibaca sebagai JSON (${path}).`);
  }
  const parsed = ServiceAccountSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FcmConfigError(
      'File service account FCM tidak lengkap: butuh project_id, client_email, dan private_key.',
    );
  }
  return parsed.data;
}

/**
 * Kanal notifikasi Android (dibuat aplikasi, lihat apps/android NotificationChannels). Dikirim di payload
 * supaya notifikasi yang ditampilkan sistem saat aplikasi tertutup tetap masuk kanal yang benar.
 */
export function channelFor(type: string | undefined): 'riset' | 'jadwal' | 'umum' {
  if (type === 'research.completed') return 'riset';
  if (type === 'schedule.result') return 'jadwal';
  return 'umum';
}

export interface PushMessage {
  token: string;
  /** Satu-satunya teks yang tampil di notifikasi; isi diambil aplikasi setelah dibuka. */
  title: string;
  /** Hanya ID dan jenis; nilai wajib string (aturan FCM). */
  data: Record<string, string>;
}

/**
 * `unregistered`: token mati (aplikasi dihapus/token kedaluwarsa), hapus dari perangkat.
 * `invalid`: FCM menolak pesan/token (cek payload). `auth`: kredensial service account ditolak.
 * `unavailable`: FCM bermasalah sementara, sudah dicoba ulang.
 */
export type PushResult =
  | { ok: true }
  | { ok: false; reason: 'unregistered' | 'invalid' | 'auth' | 'unavailable'; status?: number };

export interface FcmClient {
  send(message: PushMessage): Promise<PushResult>;
}

export interface FcmClientOptions {
  account: ServiceAccount;
  /** Mengganti server FCM (tes). */
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Jeda sebelum coba ulang (ms); tes memakai 0. */
  retryDelayMs?: number;
  log?: { warn: (obj: object, msg: string) => void };
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const ATTEMPTS = 3;
const TOKEN_MARGIN_MS = 60_000;

/** Kegagalan mengambil token OAuth: `unavailable` layak dicoba ulang, `auth` tidak (kredensial salah). */
class TokenError extends Error {
  constructor(readonly kind: 'auth' | 'unavailable') {
    super(kind);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** FCM HTTP v1: OAuth2 dari service account (JWT RS256) lalu `projects/{id}/messages:send`. */
export function createFcmClient(options: FcmClientOptions): FcmClient {
  const { account, log } = options;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const baseUrl = (options.baseUrl ?? 'https://fcm.googleapis.com').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retryDelayMs = options.retryDelayMs ?? 500;

  let cached: { token: string; expiresAt: number } | undefined;
  let inflight: Promise<string> | undefined;

  async function fetchAccessToken(): Promise<string> {
    let key: Awaited<ReturnType<typeof importPKCS8>>;
    try {
      key = await importPKCS8(account.private_key.replace(/\\n/g, '\n'), 'RS256');
    } catch {
      throw new TokenError('auth'); // kunci privat tidak terbaca: salah file, bukan gangguan jaringan
    }
    const iat = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.client_email)
      .setSubject(account.client_email)
      .setAudience(account.token_uri)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);
    let res: Response;
    try {
      res = await doFetch(account.token_uri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new TokenError('unavailable');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new TokenError(res.status === 429 || res.status >= 500 ? 'unavailable' : 'auth');
    }
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string') throw new TokenError('auth');
    const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    cached = { token: json.access_token, expiresAt: now() + ttl * 1000 };
    return json.access_token;
  }

  function accessToken(): Promise<string> {
    if (cached && cached.expiresAt - now() > TOKEN_MARGIN_MS) return Promise.resolve(cached.token);
    // Satu permintaan token untuk semua pengirim yang menunggu.
    inflight ??= fetchAccessToken().finally(() => {
      inflight = undefined;
    });
    return inflight;
  }

  function classify(status: number, body: unknown): PushResult | 'retry' | 'reauth' {
    const error = (
      body as { error?: { status?: string; details?: { errorCode?: string }[] } } | null
    )?.error;
    const codes = new Set([error?.status, ...(error?.details?.map((d) => d.errorCode) ?? [])]);
    if (codes.has('UNREGISTERED') || codes.has('NOT_FOUND') || status === 404) {
      return { ok: false, reason: 'unregistered', status };
    }
    if (codes.has('SENDER_ID_MISMATCH') || codes.has('THIRD_PARTY_AUTH_ERROR')) {
      return { ok: false, reason: 'auth', status };
    }
    if (status === 401 || codes.has('UNAUTHENTICATED')) return 'reauth';
    if (status === 400 || codes.has('INVALID_ARGUMENT'))
      return { ok: false, reason: 'invalid', status };
    if (status === 403) return { ok: false, reason: 'auth', status };
    if (status === 429 || status >= 500) return 'retry';
    return { ok: false, reason: 'invalid', status };
  }

  return {
    async send(message) {
      const url = `${baseUrl}/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
      const body = JSON.stringify({
        message: {
          token: message.token,
          notification: { title: message.title },
          data: message.data,
          android: {
            priority: 'HIGH',
            notification: { channel_id: channelFor(message.data.type) },
          },
        },
      });

      let reauthed = false;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        let token: string;
        try {
          token = await accessToken();
        } catch (err) {
          const kind = err instanceof TokenError ? err.kind : 'auth';
          log?.warn({ kind }, 'FCM: gagal mengambil access token');
          if (kind === 'unavailable' && attempt < ATTEMPTS) {
            await sleep(retryDelayMs * attempt);
            continue;
          }
          return { ok: false, reason: kind };
        }

        let res: Response;
        try {
          res = await doFetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch {
          if (attempt < ATTEMPTS) {
            await sleep(retryDelayMs * attempt);
            continue;
          }
          return { ok: false, reason: 'unavailable' };
        }
        if (res.ok) {
          await res.body?.cancel();
          return { ok: true };
        }

        const verdict = classify(res.status, await res.json().catch(() => null));
        if (verdict === 'reauth' && !reauthed) {
          reauthed = true;
          cached = undefined;
          attempt--; // pengambilan token ulang tidak menghabiskan jatah coba ulang
          continue;
        }
        if (verdict === 'retry' && attempt < ATTEMPTS) {
          await sleep(retryDelayMs * attempt);
          continue;
        }
        if (typeof verdict === 'object') return verdict;
        return {
          ok: false,
          reason: verdict === 'reauth' ? 'auth' : 'unavailable',
          status: res.status,
        };
      }
      return { ok: false, reason: 'unavailable' };
    },
  };
}
