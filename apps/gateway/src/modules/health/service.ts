import type { ReadinessSchema } from '@aios/contracts';
import type { z } from 'zod';
import type { Config } from '../../config.js';

export type Readiness = z.infer<typeof ReadinessSchema>;

export type CheckName = keyof Readiness['checks'];
export type CheckResult = Readiness['checks'][CheckName];

/** Pemeriksaan satu dependensi: selesai tanpa melempar bila sehat. */
export type Probe = (signal: AbortSignal) => Promise<void>;

/** Hanya kategori singkat yang keluar ke klien: tidak ada URL, header, atau pesan driver. */
export function describeFailure(err: unknown): string {
  if (err instanceof ProbeHttpError) return `HTTP ${err.status}`;
  const e = err as { name?: string; code?: string; cause?: { code?: string } } | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.code === 'timeout')
    return 'timeout';
  const code = e?.code ?? e?.cause?.code;
  if (code === 'ECONNREFUSED') return 'ECONNREFUSED';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS gagal';
  if (code === 'ECONNRESET') return 'ECONNRESET';
  if (typeof code === 'string' && code.startsWith('28')) return 'autentikasi ditolak';
  return 'tidak terjangkau';
}

export class ProbeHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

export async function runCheck(probe: Probe, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  const timer = new Promise<never>((_, reject) => {
    timeout.addEventListener(
      'abort',
      () => reject(Object.assign(new Error('timeout'), { code: 'timeout' })),
      {
        once: true,
      },
    );
  });
  try {
    await Promise.race([probe(timeout), timer]);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: describeFailure(err),
    };
  }
}

export interface HealthService {
  readiness(): Promise<Readiness>;
}

/** GET url dengan kunci opsional; sehat bila status 2xx. Isi respons dibuang. */
function httpProbe(url: string, apiKey?: string): Probe {
  return async (signal) => {
    const res = await fetch(url, {
      signal,
      redirect: 'manual',
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    });
    await res.body?.cancel();
    if (!res.ok) throw new ProbeHttpError(res.status);
  };
}

const joinUrl = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;

export interface HealthDeps {
  config: Pick<
    Config,
    | 'HERMES_URL'
    | 'HERMES_API_KEY'
    | 'NINEROUTER_URL'
    | 'NINEROUTER_API_KEY'
    | 'SEARXNG_URL'
    | 'READY_TIMEOUT_MS'
  >;
  /** Mengirim `select 1` ke Postgres. */
  pingDatabase: () => Promise<unknown>;
}

export function createHealthService({ config, pingDatabase }: HealthDeps): HealthService {
  const probes: Record<CheckName, Probe> = {
    postgres: async () => {
      await pingDatabase();
    },
    hermes: httpProbe(joinUrl(config.HERMES_URL, '/health'), config.HERMES_API_KEY),
    ninerouter: httpProbe(joinUrl(config.NINEROUTER_URL, '/models'), config.NINEROUTER_API_KEY),
    searxng: httpProbe(joinUrl(config.SEARXNG_URL, '/healthz')),
  };

  return {
    async readiness() {
      const entries = Object.entries(probes) as [CheckName, Probe][];
      const results = await Promise.all(
        entries.map(
          async ([name, probe]) => [name, await runCheck(probe, config.READY_TIMEOUT_MS)] as const,
        ),
      );
      const checks = Object.fromEntries(results) as Readiness['checks'];
      const allOk = results.every(([, r]) => r.ok);
      return { status: allOk ? 'ok' : 'degraded', checks };
    },
  };
}
