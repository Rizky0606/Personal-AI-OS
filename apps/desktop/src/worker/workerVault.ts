import { z } from 'zod';
import { MAX_SECRET_BYTES, type SecretStore } from '../auth/secretStore';

export const WorkerRecordSchema = z.object({
  serverUrl: z.string().min(1),
  deviceId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type WorkerRecord = z.infer<typeof WorkerRecordSchema>;

const WORKER_KEY = 'worker';

/**
 * Kredensial perangkat worker di Windows Credential Manager (entri `app.aios.desktop/worker`), terpisah dari
 * sesi desktop. Refresh token dirotasi worker; salinan terbaru dikirim balik ke sini (`session.updated`).
 */
export class WorkerVault {
  constructor(private readonly store: SecretStore) {}

  async load(): Promise<WorkerRecord | null> {
    try {
      const raw = await this.store.get(WORKER_KEY);
      if (!raw) return null;
      const parsed = WorkerRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async save(record: WorkerRecord): Promise<void> {
    const raw = JSON.stringify(record);
    if (new TextEncoder().encode(raw).length > MAX_SECRET_BYTES) {
      throw new Error('Kredensial worker terlalu besar untuk Windows Credential Manager.');
    }
    await this.store.set(WORKER_KEY, raw);
  }

  async clear(): Promise<void> {
    try {
      await this.store.remove(WORKER_KEY);
    } catch {
      // Tidak ada entri atau penyimpanan tidak bisa diakses.
    }
  }
}
