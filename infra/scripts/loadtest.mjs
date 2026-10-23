#!/usr/bin/env node
// Tes beban ringan: 5 run chat bersamaan + 1 riset mendalam. Mencatat waktu tiap pekerjaan dan, bila dijalankan di
// VPS Linux, memori dan CPU seluruh mesin serta proses utama (gateway, Hermes, 9Router, Postgres) tiap beberapa detik.
//
//   AIOS_URL=https://aios.contoh.com AIOS_TOKEN=<access> AIOS_REFRESH_TOKEN=<refresh> node infra/scripts/loadtest.mjs
//   node infra/scripts/loadtest.mjs --mock        # uji alur skrip ini sendiri terhadap server palsu (tanpa VPS)
//
// Token dari perangkat uji khusus (login sekali lewat POST /v1/auth/login); token tidak pernah dicetak.
// Opsi: --runs N (default 5), --no-research, --out hasil.json, --interval-ms 2000, --timeout-min 40.
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const RUNS = Number(option('runs', 5));
const INTERVAL_MS = Number(option('interval-ms', 2000));
const TIMEOUT_MS = Number(option('timeout-min', 40)) * 60_000;
const TERMINAL_RUN = new Set([
  'completed',
  'failed',
  'cancelled',
  'accepted',
  'rejected',
  'needs_review',
]);
const TERMINAL_RESEARCH = new Set(['completed', 'failed', 'cancelled']);

const PROMPTS = [
  'Jelaskan perbedaan proses dan thread, lengkap dengan contoh dan kapan memakai masing-masing.',
  'Tulis ringkasan tentang cara kerja indeks B-tree di PostgreSQL dan kapan indeks tidak dipakai.',
  'Bandingkan REST, GraphQL, dan gRPC untuk aplikasi seluler dengan koneksi tidak stabil.',
  'Jelaskan bagaimana TLS 1.3 handshake bekerja langkah demi langkah.',
  'Buat rencana migrasi database tanpa downtime untuk tabel berukuran 100 juta baris.',
];

// ---------------------------------------------------------------------------------------------------------------
// Ringkasan sampel (murni; diuji lewat --mock)

/** Persen CPU antara dua pembacaan /proc/stat (baris "cpu  user nice system idle iowait irq softirq steal ..."). */
export function cpuPercent(prev, cur) {
  const total = (v) => v.reduce((a, b) => a + b, 0);
  const idle = (v) => v[3] + (v[4] ?? 0);
  const dTotal = total(cur) - total(prev);
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, (100 * (dTotal - (idle(cur) - idle(prev)))) / dTotal));
}

export function summarize(samples) {
  if (samples.length === 0) return null;
  const peak = (key) => Math.max(...samples.map((s) => s[key] ?? 0));
  const cpus = samples.map((s) => s.cpuPercent ?? 0);
  const procs = {};
  for (const s of samples) {
    for (const [name, rss] of Object.entries(s.processRssMb ?? {})) {
      procs[name] = Math.max(procs[name] ?? 0, rss);
    }
  }
  return {
    samples: samples.length,
    cpuAvgPercent: round(cpus.reduce((a, b) => a + b, 0) / cpus.length),
    cpuPeakPercent: round(Math.max(...cpus)),
    memUsedPeakMb: round(peak('memUsedMb')),
    memTotalMb: round(peak('memTotalMb')),
    swapUsedPeakMb: round(peak('swapUsedMb')),
    processRssPeakMb: Object.fromEntries(Object.entries(procs).map(([k, v]) => [k, round(v)])),
  };
}

const round = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------------------------------------------
// Sampler sumber daya (Linux)

async function readProc(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function sampleHost(prevCpu) {
  const stat = await readProc('/proc/stat');
  const mem = await readProc('/proc/meminfo');
  if (!stat || !mem) return { sample: null, cpu: prevCpu };
  const cpu = stat.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(mem)?.[1] ?? 0);
  const sample = {
    cpuPercent: prevCpu ? cpuPercent(prevCpu, cpu) : 0,
    memTotalMb: kb('MemTotal') / 1024,
    memUsedMb: (kb('MemTotal') - kb('MemAvailable')) / 1024,
    swapUsedMb: (kb('SwapTotal') - kb('SwapFree')) / 1024,
    processRssMb: await sampleProcesses(),
  };
  return { sample, cpu };
}

/** RSS proses yang relevan, dikelompokkan menurut nama (jumlah semua proses bernama sama). */
async function sampleProcesses() {
  const { readdir } = await import('node:fs/promises');
  const wanted = [
    ['gateway', /node.*dist\/main\.js/],
    ['hermes', /hermes/i],
    ['9router', /9router/i],
    ['postgres', /postgres/],
    ['chromium', /chrom/i],
  ];
  const totals = {};
  let pids;
  try {
    pids = (await readdir('/proc')).filter((p) => /^\d+$/.test(p));
  } catch {
    return totals;
  }
  for (const pid of pids) {
    const cmd = (await readProc(`/proc/${pid}/cmdline`))?.replaceAll('\0', ' ');
    if (!cmd) continue;
    const match = wanted.find(([, re]) => re.test(cmd));
    if (!match) continue;
    const rssKb = Number(
      /^VmRSS:\s+(\d+)/m.exec((await readProc(`/proc/${pid}/status`)) ?? '')?.[1] ?? 0,
    );
    totals[match[0]] = (totals[match[0]] ?? 0) + rssKb / 1024;
  }
  return totals;
}

// ---------------------------------------------------------------------------------------------------------------
// Klien API

function createApi(base, tokens) {
  const state = { ...tokens };
  let refreshing = null;

  async function refresh() {
    refreshing ??= (async () => {
      const res = await fetch(`${base}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.refresh }),
      });
      if (!res.ok) throw new Error(`refresh token gagal (HTTP ${res.status}); buat token baru`);
      const body = await res.json();
      state.access = body.accessToken;
      state.refresh = body.refreshToken;
    })().finally(() => (refreshing = null));
    return refreshing;
  }

  async function call(path, init = {}, retry = true) {
    const res = await fetch(`${base}/v1${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${state.access}` },
    });
    if (res.status === 401 && retry && state.refresh) {
      await refresh();
      return call(path, init, false);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${res.status}`);
    return text ? JSON.parse(text) : null;
  }
  return { call };
}

async function pollUntil(read, done, deadline, intervalMs) {
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('batas waktu tes habis');
    await sleep(intervalMs);
  }
}

async function chatRun(api, index, deadline) {
  const started = Date.now();
  const conversation = await api.call('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: `loadtest ${index + 1}`, surface: 'windows' }),
  });
  const sent = await api.call(`/conversations/${conversation.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ parts: [{ type: 'text', text: PROMPTS[index % PROMPTS.length] }] }),
  });
  const run = await pollUntil(
    () => api.call(`/runs/${sent.run.id}`),
    (r) => TERMINAL_RUN.has(r.status),
    deadline,
    1500,
  );
  return {
    kind: 'chat',
    index: index + 1,
    status: run.status,
    seconds: round((Date.now() - started) / 1000),
  };
}

async function researchJob(api, deadline) {
  const started = Date.now();
  const job = await api.call('/research', {
    method: 'POST',
    body: JSON.stringify({
      question:
        'Bagaimana perkembangan agen AI untuk coding sepanjang tahun ini dan apa tren utamanya?',
      depth: 'deep',
    }),
  });
  const finished = await pollUntil(
    () => api.call(`/research/${job.id}`),
    (j) => TERMINAL_RESEARCH.has(j.status),
    deadline,
    3000,
  );
  return {
    kind: 'research-deep',
    status: finished.status,
    seconds: round((Date.now() - started) / 1000),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Server palsu (--mock): memeriksa alur skrip tanpa VPS.

function startMock() {
  const runs = new Map();
  const jobs = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (req.headers.authorization !== 'Bearer mock-access') return json(401, {});
      const url = req.url ?? '';
      if (req.method === 'POST' && url === '/v1/conversations') return json(201, { id: `c${++n}` });
      if (req.method === 'POST' && /\/messages$/.test(url)) {
        const id = `r${++n}`;
        runs.set(id, Date.now());
        return json(201, { run: { id } });
      }
      if (req.method === 'GET' && url.startsWith('/v1/runs/')) {
        const started = runs.get(url.split('/').pop());
        return json(200, { status: Date.now() - started > 300 ? 'completed' : 'running' });
      }
      if (req.method === 'POST' && url === '/v1/research') {
        const id = `j${++n}`;
        jobs.set(id, Date.now());
        return json(201, { id });
      }
      if (req.method === 'GET' && url.startsWith('/v1/research/')) {
        const started = jobs.get(url.split('/').pop());
        return json(200, { status: Date.now() - started > 600 ? 'completed' : 'running' });
      }
      json(404, {});
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const mock = flag('mock') ? await startMock() : null;
  const base = (mock?.url ?? process.env.AIOS_URL ?? '').replace(/\/+$/, '');
  const access = mock ? 'mock-access' : process.env.AIOS_TOKEN;
  if (!base || !access) {
    console.error(
      'Isi AIOS_URL dan AIOS_TOKEN (dan AIOS_REFRESH_TOKEN untuk tes lebih dari 15 menit), atau pakai --mock.',
    );
    process.exit(2);
  }
  const api = createApi(base, { access, refresh: process.env.AIOS_REFRESH_TOKEN });
  const deadline = Date.now() + (mock ? 30_000 : TIMEOUT_MS);

  const samples = [];
  let cpu = null;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const result = await sampleHost(cpu);
      cpu = result.cpu;
      if (result.sample) samples.push(result.sample);
      await sleep(INTERVAL_MS);
    }
  })();

  const started = Date.now();
  console.log(
    `Memulai ${RUNS} run chat${flag('no-research') ? '' : ' + 1 riset mendalam'} bersamaan ke ${mock ? 'server palsu' : base}`,
  );
  const work = [
    ...Array.from({ length: RUNS }, (_, i) => chatRun(api, i, deadline)),
    ...(flag('no-research') ? [] : [researchJob(api, deadline)]),
  ];
  const settled = await Promise.allSettled(work);
  sampling = false;
  await sampler;

  const jobs = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          kind: i < RUNS ? 'chat' : 'research-deep',
          status: 'error',
          error: String(s.reason?.message ?? s.reason),
        },
  );
  const result = {
    startedAt: new Date(started).toISOString(),
    totalSeconds: round((Date.now() - started) / 1000),
    jobs,
    resources: summarize(samples),
    note:
      samples.length === 0
        ? 'Tidak ada sampel sumber daya (bukan Linux atau /proc tidak terbaca); jalankan di VPS.'
        : undefined,
  };
  console.log(JSON.stringify(result, null, 2));
  if (option('out')) await writeFile(option('out'), `${JSON.stringify(result, null, 2)}\n`);
  mock?.server.close();
  const failed = jobs.filter((j) => j.status === 'error' || j.status === 'failed');
  process.exit(failed.length > 0 ? 1 : 0);
}

if (
  import.meta.url === new URL(process.argv[1], 'file://').href ||
  process.argv[1]?.endsWith('loadtest.mjs')
) {
  main().catch((error) => {
    console.error(`GAGAL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
