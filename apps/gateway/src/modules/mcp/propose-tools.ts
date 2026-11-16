import {
  DEFAULT_TIMEZONE,
  MemoryProposeInputSchema,
  ScheduleProposeInputSchema,
  TaskProposeInputSchema,
  type ProposalAgent,
} from '@aios/contracts';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { agentProposals, memoryProposals, runEvents } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { checkScheduleCron, type AgentProposalService } from '../agent-proposals/service.js';
import type { AgentMemoryProposals, AgentMemoryRejection } from '../memory/agent-proposals.js';
import { PENDING_MAX } from '../memory/extractor.js';
import { findSecret } from '../skills/proposals.js';
import {
  failure,
  issuesOf,
  jsonSchema,
  textResult,
  type ToolContext,
  type ToolDef,
  type ToolOutcome,
  type ToolSet,
} from './tools.js';

/** Batas usulan (docs/DESIGN_MCP_TOOLS.md bagian 17): semua jenis per run, dan per jenis per 24 jam bergulir. */
export const PROPOSALS_PER_RUN = 3;
export const PROPOSALS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Nama tool mesin yang membaca web (omp bawaan, dan `web_*` aios_tools) di `run_events`. */
const WEB_TOOL_NAMES = ['fetch', 'web_search', 'web_read', 'browser', 'web'];

export interface ProposeToolsDeps {
  db: Database;
  memory: AgentMemoryProposals;
  proposals: Pick<AgentProposalService, 'create'>;
  /** Mesin pemanggil untuk principal worker. */
  agent?: ProposalAgent;
  now?: () => number;
}

const AWAITS_OWNER = 'Belum ada yang berubah sampai pemilik menyetujuinya.';

const TOOLS: ToolDef[] = [
  {
    name: 'memory_propose',
    title: 'Usulkan memori',
    description:
      'Usulkan satu fakta awet tentang pemilik untuk diingat (preferensi, kebiasaan, identitas) yang DIKATAKAN ' +
      'pemilik sendiri di pesannya. Wajib menyertakan evidence = kutipan persis dari pesan pemilik. Hanya membuat ' +
      `usulan yang ditinjau pemilik di layar Memori; tidak menyimpan apa pun. Maksimal ${PROPOSALS_PER_RUN} usulan per run. ` +
      'Jangan pernah mengusulkan kata sandi, token, PIN, atau data rahasia lain.',
    inputSchema: jsonSchema(MemoryProposeInputSchema),
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  {
    name: 'task_propose',
    title: 'Usulkan kartu kanban',
    description:
      'Usulkan satu kartu baru di kanban project run ini (masuk Backlog setelah pemilik menyetujui). Pakai untuk ' +
      'pekerjaan lanjutan yang ditemukan tetapi di luar tugas sekarang. Hanya membuat usulan; tidak membuat kartu. ' +
      `Maksimal ${PROPOSALS_PER_RUN} usulan per run.`,
    inputSchema: jsonSchema(TaskProposeInputSchema),
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  {
    name: 'schedule_propose',
    title: 'Usulkan jadwal',
    description:
      'Usulkan satu jadwal otomatis (cron 5 field, zona waktu IANA, prompt yang dijalankan, target chat atau ' +
      'research) bila pemilik meminta sesuatu dilakukan berulang. Hanya membuat usulan; jadwal dibuat dan mulai ' +
      `berjalan setelah pemilik menyetujui. Maksimal ${PROPOSALS_PER_RUN} usulan per run.`,
    inputSchema: jsonSchema(ScheduleProposeInputSchema),
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
];

const MEMORY_REJECTIONS: Record<AgentMemoryRejection, string> = {
  evidence:
    'Kutipan evidence tidak ditemukan apa adanya di pesan pemilik. Usulkan hanya fakta yang dikatakan pemilik sendiri, dengan kutipan persis dari pesannya.',
  injection: 'Teks usulan tampak berisi instruksi, bukan fakta tentang pemilik.',
  secret: 'Usulan ditolak karena tampak memuat data rahasia. Jangan mengusulkan rahasia.',
  shape:
    'Tulis satu kalimat pernyataan tentang pemilik, tanpa baris baru dan tidak diawali kata perintah.',
  target: 'Usulan memori tidak sah.',
  duplicate:
    'Fakta ini sudah ada di memori, sudah diusulkan, atau pernah ditolak pemilik. Jangan mengusulkannya lagi.',
  pending_full: `Sudah ada ${PENDING_MAX} usulan memori yang menunggu keputusan pemilik. Jangan mengusulkan memori lagi sekarang.`,
  memory_full: 'Memori pemilik sudah penuh. Jangan mengusulkan memori baru.',
};

/**
 * Tool usulan untuk server MCP `aios_tools`: `memory_propose` (lewat jalur usulan memori yang sudah ada),
 * `task_propose` dan `schedule_propose` (tabel `agent_proposals`). Tidak ada tool yang membuat memori, kartu, atau
 * jadwal; semuanya menunggu pemilik. Mode rencana ditolak di sini juga (lapis kedua setelah worker).
 */
export function createProposeTools(deps: ProposeToolsDeps): ToolSet {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const agent = deps.agent ?? 'omp';

  /** Batas per run (semua jenis, dari kedua tabel) dan per jenis per 24 jam; pesan galat atau null. */
  async function overLimit(
    kind: 'memory' | 'task' | 'schedule',
    ctx: ToolContext,
  ): Promise<string | null> {
    const [memoryRun, agentRun] = await Promise.all([
      db
        .select({ n: count() })
        .from(memoryProposals)
        .where(and(eq(memoryProposals.runId, ctx.runId), eq(memoryProposals.source, 'agent'))),
      db.select({ n: count() }).from(agentProposals).where(eq(agentProposals.runId, ctx.runId)),
    ]);
    if ((memoryRun[0]?.n ?? 0) + (agentRun[0]?.n ?? 0) >= PROPOSALS_PER_RUN) {
      return `Batas ${PROPOSALS_PER_RUN} usulan per run tercapai. Sebutkan usulan lain di jawabanmu saja.`;
    }
    const since = new Date(now() - DAY_MS);
    const [day] =
      kind === 'memory'
        ? await db
            .select({ n: count() })
            .from(memoryProposals)
            .where(and(eq(memoryProposals.source, 'agent'), gt(memoryProposals.createdAt, since)))
        : await db
            .select({ n: count() })
            .from(agentProposals)
            .where(and(eq(agentProposals.kind, kind), gt(agentProposals.createdAt, since)));
    if ((day?.n ?? 0) >= PROPOSALS_PER_DAY) {
      return `Batas ${PROPOSALS_PER_DAY} usulan ${kind === 'memory' ? 'memori' : kind === 'task' ? 'kartu' : 'jadwal'} per hari tercapai. Sebutkan usulanmu di jawaban saja.`;
    }
    return null;
  }

  /** Run ini sudah memakai tool web sebelum mengusulkan (ditandai di usulan sebagai peringatan). */
  async function afterWeb(ctx: ToolContext): Promise<boolean> {
    const name = sql`lower(${runEvents.payload}->>'name')`;
    const [hit] = await db
      .select({ seq: runEvents.seq })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, ctx.runId),
          eq(runEvents.type, 'tool.started'),
          sql`(${name} in (${sql.join(
            WEB_TOOL_NAMES.map((n) => sql`${n}`),
            sql`, `,
          )}) or ${name} like 'mcp\\_\\_aios\\_tools\\_%web\\_%')`,
        ),
      )
      .limit(1);
    return hit !== undefined;
  }

  const planOnlyFailure = () =>
    failure(
      'Mode rencana: usulan tidak bisa dibuat. Tulis usulanmu di rencana; pemilik bisa memintanya setelah rencana disetujui.',
    );

  async function memoryPropose(args: Record<string, unknown>, ctx: ToolContext) {
    const parsed = MemoryProposeInputSchema.safeParse(args);
    if (!parsed.success)
      return failure(`Argumen memory_propose tidak valid: ${issuesOf(parsed.error)}`);
    if (ctx.planOnly) return planOnlyFailure();
    const limited = await overLimit('memory', ctx);
    if (limited) return failure(limited);
    const result = await deps.memory.propose({
      text: parsed.data.text,
      evidence: parsed.data.evidence,
      agent,
      runId: ctx.runId,
      conversationId: ctx.conversationId ?? null,
      model: ctx.model ?? agent,
      afterWeb: await afterWeb(ctx),
    });
    if ('reject' in result) return failure(MEMORY_REJECTIONS[result.reject]);
    await writeAudit(db, {
      actorDeviceId: ctx.deviceId ?? null,
      action: 'memory_proposal.agent_created',
      target: `memory_proposal:${result.ok.id} agent:${agent}`,
    });
    return done(`Usulan memori dibuat dan menunggu pemilik di layar Memori. ${AWAITS_OWNER}`);
  }

  async function taskPropose(args: Record<string, unknown>, ctx: ToolContext) {
    const parsed = TaskProposeInputSchema.safeParse(args);
    if (!parsed.success)
      return failure(`Argumen task_propose tidak valid: ${issuesOf(parsed.error)}`);
    if (ctx.planOnly) return planOnlyFailure();
    const projectId = ctx.projectId;
    if (!projectId) return failure('Run ini tidak terikat ke project, jadi tidak ada kanban.');
    if (parsed.data.projectId !== undefined && parsed.data.projectId !== projectId) {
      return failure('Kartu hanya bisa diusulkan untuk project run ini. Panggil tanpa projectId.');
    }
    const { title, body = '', reason } = parsed.data;
    if (findSecret([title, body, reason].join('\n'))) {
      return failure(
        'Usulan ditolak karena tampak memuat data rahasia. Tulis ulang tanpa rahasia.',
      );
    }
    const limited = await overLimit('task', ctx);
    if (limited) return failure(limited);
    await deps.proposals.create({
      kind: 'task',
      task: { title, body },
      projectId,
      agent,
      reason,
      afterWeb: await afterWeb(ctx),
      conversationId: ctx.conversationId ?? null,
      runId: ctx.runId,
      actorDeviceId: ctx.deviceId ?? null,
    });
    return done(`Usulan kartu "${title}" dibuat dan menunggu pemilik. ${AWAITS_OWNER}`);
  }

  async function schedulePropose(args: Record<string, unknown>, ctx: ToolContext) {
    const parsed = ScheduleProposeInputSchema.safeParse(args);
    if (!parsed.success)
      return failure(`Argumen schedule_propose tidak valid: ${issuesOf(parsed.error)}`);
    if (ctx.planOnly) return planOnlyFailure();
    const { name, prompt, target, reason } = parsed.data;
    const timezone = parsed.data.timezone ?? DEFAULT_TIMEZONE;
    let cron: string;
    try {
      cron = checkScheduleCron(parsed.data.cron, timezone);
    } catch (err) {
      if (err instanceof AppError) return failure(`${err.message} Perbaiki lalu panggil lagi.`);
      throw err;
    }
    if (findSecret([name, prompt, reason].join('\n'))) {
      return failure(
        'Usulan ditolak karena tampak memuat data rahasia. Tulis ulang tanpa rahasia.',
      );
    }
    const limited = await overLimit('schedule', ctx);
    if (limited) return failure(limited);
    const proposal = await deps.proposals.create({
      kind: 'schedule',
      schedule: { name, cron, timezone, prompt, target },
      agent,
      reason,
      afterWeb: await afterWeb(ctx),
      conversationId: ctx.conversationId ?? null,
      runId: ctx.runId,
      actorDeviceId: ctx.deviceId ?? null,
    });
    const description = proposal.kind === 'schedule' ? proposal.description : cron;
    return done(
      `Usulan jadwal "${name}" (${description}) dibuat dan menunggu pemilik. ${AWAITS_OWNER}`,
    );
  }

  const handlers: Record<
    string,
    (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>
  > = {
    memory_propose: memoryPropose,
    task_propose: taskPropose,
    schedule_propose: schedulePropose,
  };

  return {
    list: () => TOOLS,
    async call(name, args, ctx) {
      const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
      return handler ? handler(args, ctx) : null;
    },
  };
}

function done(text: string): ToolOutcome {
  return { result: textResult(text), ok: true, items: 1 };
}
