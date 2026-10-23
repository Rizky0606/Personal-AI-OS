import { loadRegistry } from '../registry.js';
import { createRouter, type Complete } from '../router/index.js';
import { ROUTING_EVAL_FILE, loadEvalCases } from './dataset.js';
import {
  DEFAULT_EVAL_THRESHOLD,
  evaluate,
  formatReport,
  modelUnavailable,
  passes,
} from './evaluate.js';

/**
 * `pnpm eval:routing` — menjalankan dataset routing melalui router sungguhan (aturan cepat + model
 * router-fast lewat 9Router) dan gagal bila akurasi satu role atau keseluruhan di bawah ambang.
 *
 * Lingkungan: NINEROUTER_URL (default http://127.0.0.1:20128/v1), NINEROUTER_API_KEY, ROUTER_MODEL (router-fast).
 * Argumen: --file <jsonl>, --threshold <0..1>, --concurrency <n>.
 * Kode keluar: 0 lulus, 1 akurasi di bawah ambang, 2 model router tidak terjangkau / dataset rusak.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function createComplete(): Complete {
  const base = (process.env.NINEROUTER_URL ?? 'http://127.0.0.1:20128/v1').replace(/\/+$/, '');
  const apiKey = process.env.NINEROUTER_API_KEY;
  const model = process.env.ROUTER_MODEL ?? 'router-fast';
  return async ({ messages, temperature, signal }) => {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, temperature, messages, stream: false }),
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('balasan tanpa isi');
    return content;
  };
}

async function main(): Promise<number> {
  const threshold = Number(arg('threshold') ?? DEFAULT_EVAL_THRESHOLD);
  const concurrency = Number(arg('concurrency') ?? 4);
  const file = arg('file') ?? ROUTING_EVAL_FILE;
  if (!(threshold > 0 && threshold <= 1)) {
    console.error('--threshold harus di antara 0 dan 1');
    return 2;
  }

  const registry = loadRegistry();
  const cases = loadEvalCases(file);
  const router = createRouter({ registry: () => registry, complete: createComplete() });
  console.log(
    `Menjalankan ${cases.length} kasus (model: ${process.env.ROUTER_MODEL ?? 'router-fast'}, ambang ${threshold * 100}%)...`,
  );
  const report = await evaluate(cases, router, { concurrency });
  console.log(`\n${formatReport(report, threshold)}\n`);

  if (modelUnavailable(report)) {
    console.error(
      'GAGAL: model router tidak terjangkau (sebagian besar kasus jatuh ke fallback). Periksa NINEROUTER_URL, NINEROUTER_API_KEY, dan combo router-fast; hasil ini bukan akurasi router.',
    );
    return 2;
  }
  if (!passes(report, threshold)) {
    console.error(
      `GAGAL: akurasi di bawah ${threshold * 100}% pada role bertanda "!" atau keseluruhan.`,
    );
    return 1;
  }
  console.log(`LULUS: semua role dan keseluruhan >= ${threshold * 100}%.`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : 'eval gagal');
    process.exitCode = 2;
  },
);
