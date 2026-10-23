import { z } from 'zod';
import { isTauri } from '../lib/tauri';

/** Penyimpanan rahasia per kunci. Produksi: Windows Credential Manager lewat perintah Rust `secret_*`. */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Batas satu entri Credential Manager (2560 byte), dengan sisa ruang. */
export const MAX_SECRET_BYTES = 2400;

export class TauriSecretStore implements SecretStore {
  async get(key: string): Promise<string | null> {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke<string | null>('secret_get', { key })) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secret_set', { key, value });
  }

  async remove(key: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('secret_remove', { key });
  }
}

/**
 * Hanya untuk pengembangan UI di peramban biasa (tanpa cangkang Tauri). Tidak aman dan tidak dipakai
 * di aplikasi: createSecretStore() memilihnya hanya bila bukan Tauri.
 */
export class BrowserDevSecretStore implements SecretStore {
  private readonly prefix = 'aios.dev.secret.';

  get(key: string): Promise<string | null> {
    return Promise.resolve(localStorage.getItem(this.prefix + key));
  }

  set(key: string, value: string): Promise<void> {
    localStorage.setItem(this.prefix + key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key);
    return Promise.resolve();
  }
}

export function createSecretStore(): SecretStore {
  return isTauri() ? new TauriSecretStore() : new BrowserDevSecretStore();
}

export const SessionRecordSchema = z.object({
  serverUrl: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Waktu access token habis (epoch ms). */
  accessExpiresAt: z.number(),
  deviceId: z.string().min(1),
  deviceName: z.string(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

const SESSION_KEY = 'session';

/** Sesi disimpan sebagai satu entri JSON. Isi yang rusak atau tak lengkap dianggap tidak ada sesi. */
export class SessionVault {
  constructor(private readonly store: SecretStore) {}

  async load(): Promise<SessionRecord | null> {
    let raw: string | null;
    try {
      raw = await this.store.get(SESSION_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const parsed = SessionRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async save(record: SessionRecord): Promise<void> {
    const raw = JSON.stringify(record);
    if (new TextEncoder().encode(raw).length > MAX_SECRET_BYTES) {
      throw new Error('Sesi terlalu besar untuk Windows Credential Manager.');
    }
    await this.store.set(SESSION_KEY, raw);
  }

  async clear(): Promise<void> {
    try {
      await this.store.remove(SESSION_KEY);
    } catch {
      // Tidak ada entri atau penyimpanan tidak bisa diakses: yang penting sesi di memori sudah dibuang.
    }
  }
}
