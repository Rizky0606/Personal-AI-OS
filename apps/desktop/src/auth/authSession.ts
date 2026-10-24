import { LoginResponseSchema, ProblemSchema, TokenPairSchema, type Problem } from '@aios/contracts';
import type { Fetcher } from '../lib/http';
import { parseServerUrl } from './serverUrl';
import type { SessionRecord, SessionVault } from './secretStore';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: 'expired' }
  | { status: 'signedIn'; session: SessionRecord };

/** Kegagalan API: `code` dari Problem (RFC 9457) bila ada; `status` 0 berarti tidak sampai ke server. */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'ApiProblem';
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export type LoginFailure = 'server_empty' | 'server_invalid' | 'server_insecure';

export class LoginInputError extends Error {
  constructor(readonly reason: LoginFailure) {
    super(reason);
    this.name = 'LoginInputError';
  }
}

export interface AuthSessionDeps {
  vault: SessionVault;
  fetcher: Fetcher;
  deviceName: () => Promise<string>;
  now?: () => number;
}

/** Sisa waktu minimum access token sebelum diperbarui lebih dulu. */
export const REFRESH_SKEW_MS = 30_000;
const PROACTIVE_MARGIN_MS = 60_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Sesi pengguna: login, penyimpanan di vault, dan pembaruan token otomatis. Refresh token dirotasi server
 * (pemakaian ulang dianggap pencurian), jadi hanya satu refresh yang boleh berjalan sekaligus: semua pemanggil
 * menunggu janji yang sama (single-flight). Dipakai sebagai external store lewat subscribe/getState.
 */
export class AuthSession {
  private state: AuthState = { status: 'loading' };
  private readonly listeners = new Set<() => void>();
  private refreshing: Promise<string | null> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;

  constructor(private readonly deps: AuthSessionDeps) {
    this.now = deps.now ?? Date.now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): AuthState => this.state;

  private set(next: AuthState): void {
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  /** Membaca vault. Tanpa sesi tersimpan: signedOut. Dengan sesi: langsung signedIn, token diperbarui bila perlu. */
  async init(): Promise<void> {
    const record = await this.deps.vault.load();
    if (!record) {
      this.set({ status: 'signedOut' });
      return;
    }
    this.set({ status: 'signedIn', session: record });
    this.schedule(record);
    if (record.accessExpiresAt - this.now() <= REFRESH_SKEW_MS) {
      // Gagal karena jaringan tidak mengeluarkan pengguna; hanya penolakan refresh token yang melakukannya.
      await this.refresh().catch(() => undefined);
    }
  }

  async login(serverInput: string, password: string, totp: string): Promise<void> {
    const parsed = parseServerUrl(serverInput);
    if (!parsed.ok) {
      throw new LoginInputError(
        parsed.reason === 'empty'
          ? 'server_empty'
          : parsed.reason === 'insecure'
            ? 'server_insecure'
            : 'server_invalid',
      );
    }
    const response = await this.request(parsed.url, '/auth/login', {
      method: 'POST',
      body: { password, totp, device: { name: await this.deps.deviceName(), kind: 'desktop' } },
    });
    const login = LoginResponseSchema.parse(response);
    const record: SessionRecord = {
      serverUrl: parsed.url,
      accessToken: login.accessToken,
      refreshToken: login.refreshToken,
      accessExpiresAt: this.now() + login.expiresIn * 1000,
      deviceId: login.device.id,
      deviceName: login.device.name,
    };
    await this.deps.vault.save(record);
    this.set({ status: 'signedIn', session: record });
    this.schedule(record);
  }

  /** Mencabut token di server bila bisa, lalu selalu menghapus sesi lokal. */
  async logout(): Promise<void> {
    const current = this.state.status === 'signedIn' ? this.state.session : null;
    if (current) {
      try {
        await this.request(current.serverUrl, '/auth/logout', {
          method: 'POST',
          token: current.accessToken,
        });
      } catch {
        // Server tidak terjangkau atau token sudah mati: sesi lokal tetap dihapus.
      }
    }
    await this.endSession();
  }

  private async endSession(reason?: 'expired'): Promise<void> {
    clearTimeout(this.timer);
    await this.deps.vault.clear();
    this.set(reason ? { status: 'signedOut', reason } : { status: 'signedOut' });
  }

  /** Access token yang masih berlaku; me-refresh dulu bila sisa waktunya kurang dari REFRESH_SKEW_MS. */
  async validAccessToken(): Promise<string | null> {
    const session = this.currentSession();
    if (!session) return null;
    if (session.accessExpiresAt - this.now() > REFRESH_SKEW_MS) return session.accessToken;
    return this.refresh();
  }

  /** Server menolak [failedToken] (401): token baru, atau null bila sesi berakhir. */
  async refreshAfterUnauthorized(failedToken: string | null): Promise<string | null> {
    const session = this.currentSession();
    if (!session) return null;
    // Pemanggil lain sudah me-refresh saat ini mengantre: pakai hasilnya.
    if (session.accessToken !== failedToken) return session.accessToken;
    return this.refresh();
  }

  /** Memeriksa sekarang bila token hampir habis (mis. setelah laptop bangun dari tidur). */
  async refreshIfNeeded(): Promise<void> {
    await this.validAccessToken().catch(() => undefined);
  }

  private currentSession(): SessionRecord | null {
    return this.state.status === 'signedIn' ? this.state.session : null;
  }

  private refresh(): Promise<string | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string | null> {
    const session = this.currentSession();
    if (!session) return null;
    try {
      const raw = await this.request(session.serverUrl, '/auth/refresh', {
        method: 'POST',
        body: { refreshToken: session.refreshToken },
      });
      const tokens = TokenPairSchema.parse(raw);
      const next: SessionRecord = {
        ...session,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: this.now() + tokens.expiresIn * 1000,
      };
      await this.deps.vault.save(next);
      this.set({ status: 'signedIn', session: next });
      this.schedule(next);
      return next.accessToken;
    } catch (error) {
      if (error instanceof ApiProblem && (error.status === 400 || error.status === 401)) {
        // Refresh token ditolak (kedaluwarsa, dicabut, atau terdeteksi dipakai ulang): sesi selesai.
        await this.endSession('expired');
        return null;
      }
      throw error;
    }
  }

  /** Memperbarui token sedikit sebelum habis supaya request biasa jarang menunggu refresh. */
  private schedule(session: SessionRecord): void {
    clearTimeout(this.timer);
    const wait = Math.max(session.accessExpiresAt - this.now() - PROACTIVE_MARGIN_MS, 0);
    this.timer = setTimeout(() => void this.refreshIfNeeded(), Math.min(wait, MAX_TIMER_MS));
  }

  /** Request ke gateway dengan Bearer dari sesi; satu kali ulang setelah refresh bila 401. */
  async authedFetch(
    path: string,
    init: { method?: string; body?: unknown; raw?: boolean } = {},
  ): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = this.currentSession();
      const token = await this.validAccessToken();
      if (!session || !token)
        throw new ApiProblem(401, 'session_expired', 'Sesi berakhir. Masuk lagi.');
      try {
        return await this.request(session.serverUrl, path, { ...init, token });
      } catch (error) {
        if (error instanceof ApiProblem && error.status === 401 && attempt === 0) {
          if (!(await this.refreshAfterUnauthorized(token))) throw error;
          continue;
        }
        throw error;
      }
    }
    throw new ApiProblem(401, 'session_expired', 'Sesi berakhir. Masuk lagi.');
  }

  /** Unduh isi biner/teks apa adanya (ekspor riset). Aturan auth dan refresh sama dengan [authedFetch]. */
  async authedBlob(path: string): Promise<Blob> {
    return (await this.authedFetch(path, { raw: true })) as Blob;
  }

  private async request(
    base: string,
    path: string,
    options: { method?: string; body?: unknown; token?: string; raw?: boolean },
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.deps.fetcher(`${base}/v1${path}`, {
        method: options.method ?? 'GET',
        headers: {
          // FormData (unggah berkas): fetch sendiri yang mengisi content-type beserta boundary.
          ...(options.body === undefined || options.body instanceof FormData
            ? {}
            : { 'content-type': 'application/json' }),
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        ...(options.body === undefined
          ? {}
          : {
              body: options.body instanceof FormData ? options.body : JSON.stringify(options.body),
            }),
      });
    } catch (error) {
      throw new ApiProblem(
        0,
        'network',
        error instanceof Error ? error.message : 'Jaringan gagal.',
      );
    }
    if (response.status === 204) return null;
    // Unduhan (ekspor laporan): isi apa adanya; hanya error yang diurai sebagai JSON.
    if (options.raw && response.ok) return response.blob();
    const text = await response.text();
    const json = parseJson(text);
    if (!response.ok) {
      const problem: Problem | null = ProblemSchema.safeParse(json).data ?? null;
      throw new ApiProblem(
        response.status,
        problem?.code ?? 'http_error',
        problem?.detail ?? `HTTP ${response.status}`,
      );
    }
    return json;
  }
}
