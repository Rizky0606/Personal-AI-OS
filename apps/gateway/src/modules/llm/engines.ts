import type { AcpProbeResult } from '@aios/adapters';
import type { EngineInfo } from '@aios/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { devices } from '../../db/schema/index.js';

export interface EnginesDeps {
  /** Mesin dsh; `undefined` bila `DSH_COMMAND` kosong. */
  dsh?: { probe(): Promise<AcpProbeResult> } | undefined;
  /** Jumlah worker Windows yang sedang tersambung (omp berjalan di sana). */
  workersOnline: () => Promise<number>;
  /** Hermes menjawab pemeriksaan kesehatan. */
  hermesUp: () => Promise<boolean>;
  log?: { warn: (obj: object, msg: string) => void };
  now?: () => number;
  /** Lama hasil pemeriksaan dsh dipakai ulang; meluncurkan proses tiap permintaan terlalu mahal. */
  probeTtlMs?: number;
}

export interface EnginesService {
  list(): Promise<EngineInfo[]>;
}

const DEFAULT_PROBE_TTL_MS = 30_000;

/**
 * `GET /engines`: mesin yang dikenal gateway beserta kemampuannya. Ketersediaan diukur, bukan diasumsikan:
 * Hermes lewat health check, omp lewat worker yang tersambung, dsh hanya bila `DSH_COMMAND` terisi DAN proses
 * dsh menjawab jabat tangan ACP. Alasan yang dikirim ke klien bersifat umum; rincian galat hanya masuk log.
 */
export function createEnginesService(deps: EnginesDeps): EnginesService {
  const now = deps.now ?? Date.now;
  const ttl = deps.probeTtlMs ?? DEFAULT_PROBE_TTL_MS;
  let dshCache: { at: number; value: Promise<AcpProbeResult> } | undefined;

  const dshHealth = (): Promise<AcpProbeResult> => {
    if (!deps.dsh) return Promise.resolve({ ok: false, reason: 'tidak dikonfigurasi' });
    if (dshCache && now() - dshCache.at < ttl) return dshCache.value;
    const value = deps.dsh.probe().catch((err: unknown): AcpProbeResult => ({
      ok: false,
      reason: err instanceof Error ? err.message : 'probe gagal',
    }));
    dshCache = { at: now(), value };
    return value;
  };

  return {
    async list() {
      const [hermes, workers, dsh] = await Promise.all([
        deps.hermesUp().catch(() => false),
        deps.workersOnline().catch(() => 0),
        dshHealth(),
      ]);
      if (deps.dsh && !dsh.ok) deps.log?.warn({ reason: dsh.reason }, 'pemeriksaan dsh gagal');
      const dshReason = !deps.dsh
        ? 'Belum dikonfigurasi di server (DSH_COMMAND kosong).'
        : 'Proses dsh tidak menjawab pemeriksaan kesehatan.';
      return [
        {
          id: 'hermes',
          label: 'Hermes',
          available: hermes,
          experimental: false,
          ...(hermes ? {} : { reason: 'Hermes tidak menjawab pemeriksaan kesehatan.' }),
          supportsModelPick: false,
          supportsTodo: false,
        },
        {
          id: 'omp',
          label: 'omp',
          available: workers > 0,
          experimental: false,
          ...(workers > 0 ? {} : { reason: 'Tidak ada worker Windows yang tersambung.' }),
          supportsModelPick: true,
          supportsTodo: true,
        },
        {
          id: 'dsh',
          label: 'dsh',
          available: dsh.ok,
          experimental: true,
          ...(dsh.ok ? {} : { reason: dshReason }),
          supportsModelPick: true,
          supportsTodo: false,
        },
      ];
    },
  };
}

/** Jumlah worker (perangkat tidak dicabut) yang sedang tersambung ke hub. */
export function workersOnlineFrom(db: Database, isOnline: (deviceId: string) => boolean) {
  return async () => {
    const rows = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.kind, 'worker'), isNull(devices.revokedAt)));
    return rows.filter((row) => isOnline(row.id)).length;
  };
}
