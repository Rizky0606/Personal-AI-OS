import type { AgentEvent, TodoPhase } from '@aios/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { startFakeHermes } from '../../apps/gateway/src/testing/fake-hermes.js';
import { startMockServer, type MockServer } from '../../apps/gateway/src/testing/mock-server.js';
import {
  articleHtml,
  classify,
  scriptedLlmReply,
} from '../../apps/gateway/src/testing/research-fakes.js';
import { mockLlm } from '../../apps/worker/src/testing/mock-llm.js';

/**
 * Layanan eksternal palsu untuk E2E: Hermes (jawaban chat mengalir), 9Router (judul, jadwal,
 * pemecah kartu, riset, dan model coding berskrip), SearXNG, dan halaman web sumber riset.
 */
export interface Fakes {
  hermesUrl: string;
  ninerouterUrl: string;
  searxngUrl: string;
  /** Teks yang dikirim Hermes (untuk memastikan streaming sungguhan terjadi). */
  hermesAnswer: string;
  /** Menyambungkan skenario "[skenario:rencana]" ke gateway e2e (event store dan berkas nyata). */
  attachScenario(hooks: ScenarioHooks): void;
  close(): Promise<void>;
}

/** Berkas nyata di gateway e2e yang dirujuk event skenario. */
export interface ScenarioFile {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

export interface ScenarioHooks {
  /** Menambahkan event ke run chat yang sedang berjalan lewat event store gateway (tersimpan dan disiarkan). */
  inject(make: (runId: string) => AgentEvent): Promise<void>;
  image: ScenarioFile;
  file: ScenarioFile;
  /** Berkas SVG: bukan gambar di aplikasi (bisa memuat skrip), harus tampil sebagai berkas. */
  svg: ScenarioFile;
  upload: ScenarioFile;
}

export const HERMES_PARTS = ['Halo! ', 'Ini jawaban ', 'streaming dari ', 'Hermes uji.'];
/** Jawaban berisi blok kode yang bisa dipratinjau dan diunduh (pesan pengguna menyebut "artifact"). */
export const ARTIFACT_PARTS = [
  'Berikut halamannya.\n\n',
  '```html index.html\n<h1 id="judul">Halo artifact</h1>\n',
  '<script>document.getElementById("judul").textContent += " berjalan";</script>\n```\n',
];
/**
 * "[skenario:kaya]": jawaban dengan blok aios-ui, seperti yang diajarkan skill inti rich-answers. Tiga blok valid
 * (tabel, grafik, checklist) dan satu blok rusak (kolom dan sel tidak sama) yang harus tampil sebagai kode.
 */
export const SCENARIO_RICH = '[skenario:kaya]';
/**
 * "[skenario:screenshot]": mesin memancarkan artifact.created berupa PNG nyata (tangkapan layar) dan satu berkas SVG,
 * keduanya tersimpan lewat modul files gateway, lalu menjawab. Hanya di stack e2e.
 */
export const SCENARIO_SHOT = '[skenario:screenshot]';
export const SHOT_ANSWER = ['Tangkapan layar ', 'sudah kuambil, ', 'diagramnya terlampir.'];
const richBlock = (value: unknown) => '```aios-ui\n' + JSON.stringify(value) + '\n```\n\n';
export const RICH_PARTS = [
  'Ini perbandingannya.\n\n',
  richBlock({
    version: 1,
    components: [
      {
        id: 'bandingan',
        type: 'table',
        columns: ['Opsi', 'Cocok untuk'],
        rows: [
          ['SQLite', 'aplikasi kecil'],
          ['Postgres', 'data bersama'],
          ['MySQL', 'hosting murah'],
        ],
      },
    ],
  }),
  'Biaya per bulan:\n\n',
  richBlock({
    version: 1,
    components: [
      {
        id: 'biaya',
        type: 'chart',
        chart: 'bar',
        label: 'Biaya per bulan',
        labels: ['SQLite', 'Postgres', 'MySQL'],
        values: [0, 15, 10],
      },
    ],
  }),
  'Yang perlu disiapkan:\n\n',
  richBlock({
    version: 1,
    components: [
      {
        id: 'siap',
        type: 'checklist',
        label: 'Persiapan',
        items: [
          { id: 'cadangan', label: 'Atur cadangan harian', checked: true },
          { id: 'indeks', label: 'Tambah indeks kolom pencarian', checked: false },
        ],
      },
    ],
  }),
  'Satu blok ini rusak:\n\n',
  richBlock({
    version: 1,
    components: [{ id: 'rusak', type: 'table', columns: ['A', 'B'], rows: [['satu']] }],
  }),
  'Selesai.',
];
/**
 * Skenario run berjalan untuk bukti visual dan tes chat. Pesan yang memuat penandanya membuat Hermes palsu
 * mengirim urutan event nyata (reasoning_content dan event SSE hermes.tool.progress) yang dipetakan adapter
 * Hermes sungguhan dan mengalir lewat gateway: 5 tool berurutan dengan durasi 400-900 ms, satu output per
 * tool, lalu jawaban. Hanya ada di stack e2e. "[skenario:izin]" tidak lewat Hermes (Hermes tidak punya
 * izin): pesan di dalam project memakai skrip omp di bawah, yang berhenti di approval.requested.
 */
export const SCENARIO_TOOL = '[skenario:tool]';
export const SCENARIO_ERROR = '[skenario:error]';
export const SCENARIO_APPROVAL = '[skenario:izin]';
export const SCENARIO_REASONING = [
  'Aku perlu membaca login.ts dulu untuk memahami alur masuknya. ',
  'Setelah itu kucari semua pemakai handleLogin sebelum mengubah apa pun.',
];
export const SCENARIO_ANSWER = ['Sudah beres. ', 'Alur masuk kini ', 'memeriksa sandi kosong.'];
export const SCENARIO_STEPS = [
  {
    tool: 'read_file',
    target: 'src/auth/login.ts',
    ms: 500,
    output: 'export function handleLogin(email, sandi) { … } (84 baris)',
  },
  {
    tool: 'search_files',
    target: 'handleLogin',
    ms: 700,
    output: 'src/auth/login.ts:12 src/auth/login.test.ts:8',
  },
  { tool: 'terminal', target: 'pnpm typecheck', ms: 900, output: 'tsc: tidak ada galat' },
  { tool: 'patch', target: 'src/auth/login.ts', ms: 600, output: '1 berkas diubah (+4 -1)' },
  { tool: 'terminal', target: 'pnpm test auth', ms: 800, output: '12 tes lulus' },
];
export const SCENARIO_ERROR_OUTPUT = 'error TS2322: Type string is not assignable to type number';
/**
 * "[skenario:rencana]": Hermes tidak punya rencana, artifact, dan diff, jadi fake menyisipkan event itu ke run yang
 * sedang berjalan lewat event store gateway: konteks yang dipakai (2 skill, 3 fakta memori, 1 lampiran), rencana 9
 * langkah yang maju satu per satu tiap 600 ms, 2 artifact (gambar dan berkas), dan diff. Hanya di stack e2e.
 */
export const SCENARIO_PLAN = '[skenario:rencana]';
export const PLAN_STEP_MS = 600;
export const PLAN_PHASES = [
  {
    name: 'Persiapan',
    tasks: ['Baca login.ts', 'Cari pemakai handleLogin', 'Tulis tes yang gagal'],
  },
  {
    name: 'Pengerjaan',
    tasks: ['Ubah login.ts', 'Perbarui tes login', 'Jalankan typecheck', 'Jalankan tes'],
  },
  { name: 'Verifikasi', tasks: ['Perbaiki galat tes', 'Periksa hasil'] },
] as const;
export const PLAN_TOTAL = PLAN_PHASES.reduce((n, p) => n + p.tasks.length, 0);
export const PLAN_MEMORY = [
  { id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e21', title: 'Suka jawaban singkat' },
  { id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e22', title: 'Pakai bahasa Indonesia.' },
  { id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e23', title: 'Zona waktu Asia/Jakarta.' },
];
export const PLAN_ANSWER = ['Rencana ', 'selesai dikerjakan, ', 'semua langkah lulus.'];

/** Rencana dengan langkah ke-`active` (mulai 0) sedang dikerjakan; `active` = total berarti semuanya selesai. */
export function planAt(active: number): TodoPhase[] {
  let index = 0;
  return PLAN_PHASES.map((phase) => ({
    name: phase.name,
    tasks: phase.tasks.map((content) => {
      const i = index++;
      return {
        content,
        status:
          i < active
            ? ('completed' as const)
            : i === active
              ? ('in_progress' as const)
              : ('pending' as const),
      };
    }),
  }));
}

export const CODING_FILE = 'catatan-e2e.txt';
export const CODING_COMMIT = 'docs: tambah catatan e2e';

/**
 * "[skenario:tim]": prompt pertama Lead (P7 ORCA) membuat rencana 2 tugas; Worker mengerjakan
 * keduanya berurutan (maxWorkers:1) lewat skrip coding omp yang SAMA dipakai coding.spec.ts
 * (tulis CODING_FILE lalu selesai) -- diputuskan reuse, bukan skrip LLM baru per tugas, karena
 * tujuan e2e ini membuktikan ORKESTRASI (rencana -> dispatch -> tinjau -> accept, dua kali),
 * bukan keragaman isi kode. Lead selalu menerima (TEAM_REVIEW_ACCEPT) untuk request tinjauan apa
 * pun -- dikenali dari teks yang DIBUAT ORCHESTRATOR sendiri ("Tinjau hasil Worker..."), bukan
 * marker yang diketik pengguna (request tinjauan tidak lewat composer).
 */
export const SCENARIO_TEAM = '[skenario:tim]';
export const TEAM_TASK_1 = 'Tambah tes pertama';
export const TEAM_TASK_2 = 'Tambah tes kedua';
export const TEAM_PLAN_TWO_TASKS =
  'Rencana: dua tugas untuk Worker.\n```orca-plan\n' +
  JSON.stringify({
    tasks: [
      {
        title: TEAM_TASK_1,
        prompt: 'Tambahkan catatan e2e pertama.',
        acceptanceCriteria: 'Berkas catatan ada.',
      },
      {
        title: TEAM_TASK_2,
        prompt: 'Tambahkan catatan e2e kedua.',
        acceptanceCriteria: 'Berkas catatan ada.',
      },
    ],
  }) +
  '\n```';
export const TEAM_REVIEW_ACCEPT =
  'Hasil sudah memenuhi kriteria.\n```orca-review\n' +
  JSON.stringify({ decision: 'accept', feedback: 'Bagus, sesuai permintaan.' }) +
  '\n```';

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const json = (res: ServerResponse, value: unknown) =>
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));

const completion = (content: string) => ({
  choices: [{ index: 0, message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 12, completion_tokens: 7 },
});

interface ChatBody {
  model?: string;
  tools?: unknown[];
  messages: { role: string; content?: unknown }[];
}

const textOf = (content: unknown) => (typeof content === 'string' ? content : '');

export async function startFakes(): Promise<Fakes> {
  const hermes = await startFakeHermes();
  let scenario: ScenarioHooks | undefined;
  hermes.onRequest(async (stream, req, res) => {
    const last = req.body.messages.at(-1)?.content;
    if (typeof last === 'string' && last.includes(SCENARIO_PLAN)) {
      if (!scenario) throw new Error('skenario rencana belum disambungkan (attachScenario)');
      const hooks = scenario;
      // Aliran dibuka segera dan diberi detak jantung (event bernama yang diabaikan adapter) supaya tidak dianggap macet.
      stream.reasoning('');
      const beat = () => res.write('event: hermes.heartbeat\ndata: {}\n\n');
      const wait = async (ms: number) => {
        for (let left = ms; left > 0; left -= 200) {
          beat();
          await sleep(Math.min(200, left));
        }
      };
      try {
        await wait(300);
        await hooks.inject((runId) => ({
          type: 'context.used',
          runId,
          role: 'general',
          engine: 'hermes',
          model: 'combo/general',
          skills: ['plan-progress', 'answer-first'],
          memory: { read: PLAN_MEMORY.length, items: PLAN_MEMORY },
          attachments: [
            { fileId: hooks.upload.fileId, name: hooks.upload.name, mime: hooks.upload.mime },
          ],
        }));
        const artifact = (file: ScenarioFile, source: 'screenshot' | 'file') =>
          hooks.inject(() => ({
            type: 'artifact.created',
            fileId: file.fileId,
            name: file.name,
            mime: file.mime,
            size: file.size,
            sha256: file.sha256,
            source,
          }));
        for (let step = 0; step < PLAN_TOTAL; step++) {
          await hooks.inject(() => ({ type: 'todo.updated', phases: planAt(step) }));
          // Hanya `pnpm shots`: menahan langkah ke-7 supaya screenshot "langkah 7" deterministik.
          await wait(PLAN_STEP_MS + (step === 6 ? Number(process.env.SHOTS_PLAN_HOLD_MS ?? 0) : 0));
          if (step === 2) await artifact(hooks.image, 'screenshot');
          if (step === 5) await artifact(hooks.file, 'file');
          if (step === 7)
            await hooks.inject(() => ({
              type: 'diff.updated',
              files: [
                { path: 'src/auth/login.ts', additions: 4, deletions: 1 },
                { path: 'src/auth/login.test.ts', additions: 12, deletions: 0 },
              ],
            }));
        }
        await hooks.inject(() => ({ type: 'todo.updated', phases: planAt(PLAN_TOTAL) }));
        for (const part of PLAN_ANSWER) {
          stream.delta(part);
          await sleep(180);
        }
        stream.usage(30, 18);
        stream.finish();
        stream.done();
      } catch (error) {
        // Galat skenario tidak boleh mematikan proses e2e: akhiri aliran supaya run gagal dengan jelas.
        console.error('[e2e] skenario rencana gagal:', error);
        stream.end();
      }
      return;
    }
    if (typeof last === 'string' && last.includes(SCENARIO_SHOT)) {
      if (!scenario) throw new Error('skenario screenshot belum disambungkan (attachScenario)');
      const hooks = scenario;
      stream.reasoning('');
      try {
        await sleep(300);
        for (const [file, source] of [
          [hooks.image, 'screenshot'],
          [hooks.svg, 'file'],
        ] as const) {
          await hooks.inject(() => ({
            type: 'artifact.created',
            fileId: file.fileId,
            name: file.name,
            mime: file.mime,
            size: file.size,
            sha256: file.sha256,
            source,
          }));
        }
        for (const part of SHOT_ANSWER) {
          stream.delta(part);
          await sleep(150);
        }
        stream.usage(20, 12);
        stream.finish();
        stream.done();
      } catch (error) {
        console.error('[e2e] skenario screenshot gagal:', error);
        stream.end();
      }
      return;
    }
    if (typeof last === 'string' && last.includes(SCENARIO_RICH)) {
      for (const part of RICH_PARTS) {
        stream.delta(part);
        await sleep(120);
      }
      stream.usage(30, 40);
      stream.finish();
      stream.done();
      return;
    }
    const toolScenario =
      typeof last === 'string' && last.includes(SCENARIO_TOOL)
        ? 'tool'
        : typeof last === 'string' && last.includes(SCENARIO_ERROR)
          ? 'error'
          : null;
    if (toolScenario) {
      for (const sentence of SCENARIO_REASONING) {
        stream.reasoning(sentence);
        await sleep(150);
      }
      const progress = (payload: Record<string, unknown>) =>
        res.write('event: hermes.tool.progress\ndata: ' + JSON.stringify(payload) + '\n\n');
      for (const [i, step] of SCENARIO_STEPS.entries()) {
        const toolCallId = `skenario-${i + 1}`;
        progress({ toolCallId, tool: step.tool, status: 'running', target: step.target });
        await sleep(step.ms);
        const failed = toolScenario === 'error' && i === 2;
        progress({
          toolCallId,
          tool: step.tool,
          status: failed ? 'failed' : 'completed',
          output: failed ? SCENARIO_ERROR_OUTPUT : step.output,
        });
      }
      for (const part of SCENARIO_ANSWER) {
        stream.delta(part);
        await sleep(180);
      }
      stream.usage(40, 24);
      stream.finish();
      stream.done();
      return;
    }
    // Lead tim Orca (P7): request pertama (prompt pengguna dengan marker) -> rencana 2 tugas;
    // request berikutnya (dibuat orchestrator, bukan diketik pengguna) -> selalu accept.
    if (typeof last === 'string' && last.includes('Tinjau hasil Worker untuk tugas ini')) {
      stream.delta(TEAM_REVIEW_ACCEPT);
      stream.usage(20, 15);
      stream.finish();
      stream.done();
      return;
    }
    if (typeof last === 'string' && last.includes(SCENARIO_TEAM)) {
      stream.delta(TEAM_PLAN_TWO_TASKS);
      stream.usage(20, 30);
      stream.finish();
      stream.done();
      return;
    }
    const parts =
      typeof last === 'string' && last.includes('artifact') ? ARTIFACT_PARTS : HERMES_PARTS;
    for (const part of parts) {
      stream.delta(part);
      await sleep(180);
    }
    stream.usage(20, 12);
    stream.finish();
    stream.done();
  });

  const web = await startMockServer((req, res) => {
    const n = Number(/artikel-(\d+)/.exec(req.url ?? '')?.[1]);
    if (!Number.isFinite(n)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(articleHtml(`Sumber ${n} tentang kendaraan listrik`, { published: '2026-01-15' }));
  });

  const searx = await startMockServer((req, res) => {
    if (req.url?.startsWith('/healthz')) return void res.writeHead(200).end('OK');
    const results = Array.from({ length: 8 }, (_, i) => ({
      url: `${web.url}/artikel-${i + 1}`,
      title: `Sumber ${i + 1}`,
      content: 'cuplikan',
      engine: 'fake',
    }));
    json(res, { results });
  });

  // Model coding berskrip: tulis satu berkas, lalu tutup dengan baris Commit (diminta worker lewat prompt sistem).
  const coding = mockLlm((toolResults) =>
    toolResults === 0
      ? { tool: { name: 'write', args: { path: CODING_FILE, content: 'dibuat oleh agent E2E\n' } } }
      : { text: `Catatan sudah ditambahkan.\nCommit: ${CODING_COMMIT}` },
  );

  const nine: MockServer = await startMockServer((req, res) => {
    if (req.url?.includes('/models')) {
      return json(res, {
        object: 'list',
        data: [
          { id: 'router-fast', object: 'model', owned_by: 'combo' },
          { id: 'coding-main', object: 'model', owned_by: 'combo' },
          { id: 'general-cheap', object: 'model', owned_by: 'combo' },
        ],
      });
    }
    void (async () => {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as ChatBody;
      // Permintaan omp (punya tools) memakai skrip coding yang mengalir lewat SSE.
      if ((body.tools?.length ?? 0) > 0) {
        const replay = new (await import('node:stream')).PassThrough();
        replay.end(raw);
        Object.assign(replay, { url: req.url, headers: req.headers, method: req.method });
        return coding.handler(replay as unknown as IncomingMessage, res);
      }
      const system = textOf(body.messages.find((m) => m.role === 'system')?.content);
      const user = textOf(body.messages.findLast((m) => m.role === 'user')?.content);

      if (system.includes('pengurai jadwal')) {
        return json(
          res,
          completion(
            JSON.stringify({
              name: 'Ringkasan berita AI',
              cron: '0 7 * * 1',
              timezone: 'Asia/Jakarta',
              prompt: 'Ringkas berita AI minggu ini.',
              target: 'chat',
              agent_role: null,
              error: null,
            }),
          ),
        );
      }
      if (system.includes('perencana tugas coding')) {
        return json(
          res,
          completion(
            JSON.stringify({
              items: [
                { title: 'Buat halaman login', body: 'Form email dan sandi', role: 'project' },
                { title: 'Endpoint login', body: '', role: 'project' },
                { title: 'Tulis catatan rilis', body: '', role: null },
              ],
            }),
          ),
        );
      }
      const request = { model: body.model ?? '', system, user };
      const kind = classify(request);
      if (
        system.includes('perencana riset') ||
        system.includes('peringkas sumber') ||
        kind !== 'synthesis' ||
        user.includes('Sumber:')
      ) {
        return json(res, completion(scriptedLlmReply(request)));
      }
      return json(res, completion('Judul uji'));
    })();
  });

  return {
    hermesUrl: hermes.url,
    ninerouterUrl: nine.url,
    searxngUrl: searx.url,
    hermesAnswer: HERMES_PARTS.join(''),
    attachScenario(hooks) {
      scenario = hooks;
    },
    async close() {
      await Promise.all([hermes.close(), web.close(), searx.close(), nine.close()]);
    },
  };
}
