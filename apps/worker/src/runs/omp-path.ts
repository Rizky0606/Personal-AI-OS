import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import type { OmpModelLimits } from '@aios/adapters';

export class OmpNotFoundError extends Error {
  constructor() {
    super(
      'omp tidak ditemukan di PC ini. Pasang omp atau isi AIOS_OMP_PATH dengan lokasi omp.exe.',
    );
    this.name = 'OmpNotFoundError';
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Lokasi `omp` yang dijalankan tanpa shell. `AIOS_OMP_PATH` menang; selain itu dicari di PATH:
 * `omp.exe` di Windows (pembungkus .cmd tidak bisa dijalankan tanpa shell), `omp` di tempat lain.
 */
export async function resolveOmp(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  const override = env.AIOS_OMP_PATH;
  if (override) {
    if (await isFile(override)) return override;
    throw new OmpNotFoundError();
  }
  const names = platform === 'win32' ? ['omp.exe'] : ['omp'];
  const separator = platform === 'win32' ? ';' : ':';
  const pathValue = env.PATH ?? env.Path ?? '';
  for (const dir of pathValue.split(separator).filter(Boolean)) {
    for (const name of names) {
      const candidate = nodePath.join(dir, name);
      if (await isFile(candidate)) return candidate;
    }
  }
  throw new OmpNotFoundError();
}

/** Versi omp (`omp --version`), atau null bila tidak terpasang atau tidak menjawab. Tidak pernah melempar. */
export async function readOmpVersion(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  try {
    const exe = await resolveOmp(env);
    const { execFile } = await import('node:child_process');
    return await new Promise<string | null>((resolve) => {
      execFile(exe, ['--version'], { timeout: 8000, windowsHide: true }, (error, stdout) => {
        const match = error ? null : /\d+\.\d+\.\d+\S*/.exec(stdout);
        resolve(match ? match[0] : null);
      });
    });
  } catch {
    return null;
  }
}

/**
 * Isian model `models.yml` omp dari lingkungan worker: `AIOS_OMP_REASONING` (`true`/`false`),
 * `AIOS_OMP_CONTEXT_WINDOW` dan `AIOS_OMP_MAX_TOKENS` (bilangan bulat positif). Nilai yang tidak valid diabaikan
 * (bawaan adapter berlaku) dan dilaporkan lewat `warn`.
 */
export function ompModelLimits(
  env: NodeJS.ProcessEnv,
  warn: (message: string) => void = () => undefined,
): Partial<OmpModelLimits> {
  const limits: Partial<OmpModelLimits> = {};
  const reasoning = env.AIOS_OMP_REASONING?.trim().toLowerCase();
  if (reasoning === 'true' || reasoning === 'false') limits.reasoning = reasoning === 'true';
  else if (reasoning) warn(`AIOS_OMP_REASONING tidak valid (${reasoning}); memakai bawaan.`);
  for (const [name, key] of [
    ['AIOS_OMP_CONTEXT_WINDOW', 'contextWindow'],
    ['AIOS_OMP_MAX_TOKENS', 'maxTokens'],
  ] as const) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    if (/^[1-9]\d{0,8}$/.test(raw)) limits[key] = Number(raw);
    else warn(`${name} tidak valid (${raw}); memakai bawaan.`);
  }
  return limits;
}
