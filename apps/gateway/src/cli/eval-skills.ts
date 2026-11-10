/**
 * Evaluasi murah pemilihan skill oleh agent (P9 task 7). Bukan tes CI wajib.
 *
 *   pnpm eval:skills [--from=N] [--limit=N] [--engine=hermes|omp|all]
 *
 * Tiap pesan dibangun persis seperti gateway (agent + paket kata kunci -> indeks skill), dijalankan ke mesin
 * sungguhan, lalu dilaporkan skill yang DIBUKA. Mesin yang tidak tersedia dilewati dengan alasan:
 *  - Hermes: perlu HERMES_API_KEY dan /health yang menjawab (HERMES_URL). Skill aios- harus sudah disinkron
 *    (`pnpm skills:sync-hermes`). Pembukaan skill di Hermes hanya dilaporkan bila tool-nya terlihat di stream;
 *    bila tidak terlihat, ditulis "tidak teramati" (tidak ditebak).
 *  - omp: perlu omp terpasang dan AIOS_EVAL_OMP_BASE_URL, AIOS_EVAL_OMP_API_KEY, AIOS_EVAL_OMP_MODEL (endpoint
 *    OpenAI-compatible). Pembukaan = tool read skill://<nama>; teramati penuh.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createHermesAdapter,
  createOmpAdapter,
  stdioTransport,
  uuidv7,
  type AgentAdapter,
} from '@aios/adapters';
import { buildBundle, loadRegistry, selectSkills } from '@aios/roles';
import { SKILL_EVAL_CASES, type SkillEvalCase } from './eval-skills.data.js';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const limit = Number(flag('limit') ?? SKILL_EVAL_CASES.length);
const from = Number(flag('from') ?? 0);
const only = flag('engine') ?? 'all';
const registry = loadRegistry();
const known = new Set(registry.skills.keys());

interface Outcome {
  /** null = pembukaan tidak teramati oleh mesin ini. */
  opened: string[] | null;
  note?: string;
}

async function runAdapter(
  adapter: AgentAdapter,
  input: Parameters<AgentAdapter['startRun']>[0],
  watch: (event: { type: string; name?: string; target?: string }) => void,
): Promise<void> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 180_000);
  try {
    const handle = await adapter.startRun({ ...input, signal: abort.signal });
    for await (const event of handle.events) {
      watch(event);
      if (event.type === 'approval.requested')
        await handle.resolveApproval(event.approvalId, 'deny');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function hermesReady(): Promise<string | null> {
  const key = process.env.HERMES_API_KEY;
  if (!key) return 'HERMES_API_KEY tidak diisi';
  const url = (process.env.HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok ? null : `Hermes /health HTTP ${res.status}`;
  } catch {
    return 'Hermes tidak terjangkau';
  }
}

async function runHermes(c: SkillEvalCase, systemPrompt: string): Promise<Outcome> {
  const adapter = createHermesAdapter({
    baseUrl: process.env.HERMES_URL ?? 'http://127.0.0.1:8642',
    apiKey: process.env.HERMES_API_KEY,
  });
  const opened = new Set<string>();
  let skillToolSeen = false;
  await runAdapter(
    adapter,
    {
      runId: uuidv7(),
      messageId: uuidv7(),
      prompt: c.message,
      systemPrompt,
      sessionId: `eval-skills-${uuidv7()}`,
    },
    (event) => {
      if (event.type !== 'tool.started' || !/skill/i.test(event.name ?? '')) return;
      skillToolSeen = true;
      const hit = /aios-([a-z][a-z0-9-]*)/.exec(event.target ?? '')?.[1];
      if (hit && known.has(hit)) opened.add(hit);
    },
  );
  return skillToolSeen
    ? { opened: [...opened] }
    : { opened: null, note: 'pembukaan skill tidak teramati' };
}

function ompReady(): string | null {
  for (const name of ['AIOS_EVAL_OMP_BASE_URL', 'AIOS_EVAL_OMP_API_KEY', 'AIOS_EVAL_OMP_MODEL']) {
    if (!process.env[name]) return `${name} tidak diisi`;
  }
  return null;
}

async function runOmp(c: SkillEvalCase, systemPrompt: string, offered: string[]): Promise<Outcome> {
  const exe = process.env.AIOS_OMP_PATH ?? 'omp';
  const dir = await mkdtemp(join(tmpdir(), 'aios-eval-omp-'));
  try {
    const adapter = createOmpAdapter({
      llm: {
        baseUrl: process.env.AIOS_EVAL_OMP_BASE_URL!,
        apiKey: process.env.AIOS_EVAL_OMP_API_KEY!,
      },
      launch: (spec) => {
        const child = spawn(exe, spec.args, {
          cwd: spec.cwd,
          env: { ...process.env, ...spec.env, NO_COLOR: '1' },
        });
        return stdioTransport(child, () => child.kill('SIGKILL'));
      },
    });
    const skills = offered.flatMap((id) => {
      const skill = registry.skills.get(id);
      return skill
        ? [
            {
              id,
              description: skill.description,
              body: skill.body,
              checksum: createHash('sha256').update(skill.body).digest('hex'),
            },
          ]
        : [];
    });
    const opened = new Set<string>();
    await runAdapter(
      adapter,
      {
        runId: uuidv7(),
        messageId: uuidv7(),
        prompt: c.message,
        systemPrompt,
        model: process.env.AIOS_EVAL_OMP_MODEL!,
        cwd: dir,
        runDir: join(dir, 'run'),
        skills,
        skillIds: offered,
      },
      (event) => {
        if (event.type !== 'tool.started' || event.name !== 'read') return;
        const id = /^skill:\/\/([a-z][a-z0-9-]*)/.exec(event.target ?? '')?.[1];
        if (id && offered.includes(id)) opened.add(id);
      },
    );
    return { opened: [...opened] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const hermesSkip = await hermesReady();
const ompSkip = ompReady();
console.log(
  `hermes: ${hermesSkip ? `DILEWATI (${hermesSkip})` : 'siap'} | omp: ${ompSkip ? `DILEWATI (${ompSkip})` : 'siap'}`,
);

const tally = { hermes: { run: 0, hit: 0 }, omp: { run: 0, hit: 0 } };
for (const c of SKILL_EVAL_CASES.slice(from, from + limit)) {
  const { skills: suggested } = selectSkills(c.message, { agent: c.agent, known });
  const engine = c.agent === 'project' ? 'omp' : 'hermes';
  const bundle = buildBundle(registry, c.agent, {
    suggestedSkills: suggested,
    skillNamePrefix: engine === 'hermes' ? 'aios-' : '',
  });
  const skip = engine === 'omp' ? ompSkip : hermesSkip;
  const label = `[${c.group}/${engine}] ${c.message}`;
  const expected = c.expectAny.length ? c.expectAny.join('|') : '(tanpa skill)';
  if ((only !== 'all' && only !== engine) || skip) {
    console.log(
      `${label}\n  tersedia: ${bundle.offeredSkills.join(', ') || '-'} | diharapkan: ${expected} | DILEWATI`,
    );
    continue;
  }
  try {
    const out =
      engine === 'omp'
        ? await runOmp(c, bundle.systemPrompt, bundle.offeredSkills)
        : await runHermes(c, bundle.systemPrompt);
    const hit =
      out.opened === null
        ? null
        : c.expectAny.length === 0
          ? out.opened.length === 0
          : c.expectAny.some((id) => out.opened!.includes(id));
    tally[engine].run += 1;
    if (hit) tally[engine].hit += 1;
    const opened =
      out.opened === null
        ? `tidak teramati (tersedia: ${bundle.offeredSkills.join(', ') || '-'})`
        : out.opened.join(', ') || '-';
    console.log(
      `${label}\n  dibuka: ${opened} | diharapkan: ${expected} | ${hit === null ? 'n/a' : hit ? 'TEPAT' : 'MELESET'}`,
    );
  } catch (error) {
    console.log(`${label}\n  GAGAL: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(
  `\nringkasan: hermes ${tally.hermes.hit}/${tally.hermes.run} tepat, omp ${tally.omp.hit}/${tally.omp.run} tepat`,
);
