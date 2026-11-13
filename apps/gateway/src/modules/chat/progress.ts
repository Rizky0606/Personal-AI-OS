import {
  PROGRESS_OUTPUTS_MAX,
  isRasterImageMime,
  type ConversationProgress,
  type DiffFile,
  type ProgressOutput,
  type TodoPhase,
} from '@aios/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  files,
  messages,
  researchJobs,
  runEvents,
  runs,
  skillProposals,
} from '../../db/schema/index.js';

// Bentuk respons menjadikan openedSkills/pinnedSkills opsional (data lama); di sini selalu terisi.
type Used = ConversationProgress['used'] & { openedSkills: string[]; pinnedSkills: string[] };

const empty = (): Omit<ConversationProgress, 'used'> & { used: Used } => ({
  plan: null,
  outputs: [],
  used: {
    skills: [],
    openedSkills: [],
    pinnedSkills: [],
    engine: null,
    model: null,
    memory: { read: 0, items: [] },
    attachments: [],
    tools: [],
  },
});

const iso = (value: Date | string) => new Date(value).toISOString();

/**
 * Agregat panel Progres satu percakapan, dibangun dari event run yang tersimpan (tanpa tabel baru) sehingga tahan
 * muat ulang. Hanya metadata: tidak ada isi memori, isi lampiran, atau teks jawaban.
 */
export async function conversationProgress(
  db: Database,
  conversationId: string,
): Promise<ConversationProgress> {
  const runRows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.conversationId, conversationId))
    .orderBy(asc(runs.createdAt), asc(runs.id));
  if (runRows.length === 0) return empty();
  const runIds = runRows.map((r) => r.id);
  const order = new Map(runIds.map((id, i) => [id, i]));
  const byRun = <T extends { runId: string }>(a: T, b: T) =>
    (order.get(a.runId) ?? 0) - (order.get(b.runId) ?? 0);

  // Rencana dan diff: hanya event terakhir per run, dihitung di SQL supaya run panjang tidak ikut terbaca semua.
  const lastOf = async (type: 'todo.updated' | 'diff.updated') => {
    const result = await db.execute<{ run_id: string; ts: Date; payload: unknown }>(sql`
      select distinct on (run_id) run_id, ts, payload from run_events
      where run_id in (${sql.join(
        runIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) and type = ${type}
      order by run_id, seq desc`);
    return result.rows.map((r) => ({ runId: r.run_id, at: iso(r.ts), payload: r.payload }));
  };
  const [todos, diffs] = await Promise.all([lastOf('todo.updated'), lastOf('diff.updated')]);

  const events = await db
    .select({
      runId: runEvents.runId,
      seq: runEvents.seq,
      ts: runEvents.ts,
      payload: runEvents.payload,
    })
    .from(runEvents)
    .where(
      and(
        inArray(runEvents.runId, runIds),
        inArray(runEvents.type, ['artifact.created', 'context.used', 'tool.started']),
      ),
    )
    .orderBy(asc(runEvents.runId), asc(runEvents.seq));
  events.sort(byRun);

  // Rencana: todo.updated terakhir dari run terakhir yang punya rencana.
  const latestPlan = todos.sort(byRun).at(-1);
  const plan = latestPlan
    ? {
        runId: latestPlan.runId,
        phases: (latestPlan.payload as { phases: TodoPhase[] }).phases,
      }
    : null;

  const used: Used = empty().used;
  const tools = new Set<string>();
  const outputs: ProgressOutput[] = [];
  const seenFiles = new Set<string>();
  for (const row of events) {
    const event = row.payload;
    if (event.type === 'tool.started') tools.add(event.name);
    else if (event.type === 'context.used') {
      for (const skill of event.skills) if (!used.skills.includes(skill)) used.skills.push(skill);
      // Event lama di DB belum punya openedSkills/pinnedSkills (payload mentah, bukan hasil parse ulang).
      for (const skill of event.openedSkills ?? []) {
        if (!used.openedSkills.includes(skill)) used.openedSkills.push(skill);
      }
      for (const skill of event.pinnedSkills ?? []) {
        if (!used.pinnedSkills.includes(skill)) used.pinnedSkills.push(skill);
      }
      for (const file of event.attachments)
        if (!used.attachments.some((a) => a.fileId === file.fileId)) used.attachments.push(file);
      // Engine, model, dan memori mengikuti run terbaru.
      used.engine = event.engine;
      used.model = event.model;
      used.memory = { read: event.memory.read, items: event.memory.items ?? [] };
    } else if (event.type === 'artifact.created') {
      seenFiles.add(event.fileId);
      outputs.push({
        kind: isRasterImageMime(event.mime) ? 'image' : 'file',
        runId: row.runId,
        at: iso(row.ts),
        fileId: event.fileId,
        name: event.name,
        mime: event.mime,
        size: event.size,
      });
    }
  }
  used.tools = [...tools];

  for (const diff of diffs) {
    const { files: changed } = diff.payload as { files: DiffFile[] };
    if (changed.length > 0) {
      outputs.push({ kind: 'diff', runId: diff.runId, at: diff.at, files: changed });
    }
  }

  // Berkas buatan agent di server ditempel ke jawaban sebagai bagian `file`.
  const assistant = await db
    .select({ runId: messages.runId, createdAt: messages.createdAt, parts: messages.parts })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.author, 'assistant')));
  const generated = assistant.flatMap((m) =>
    m.parts.flatMap((part) =>
      part.type === 'file' && !seenFiles.has(part.fileId) && m.runId
        ? [
            {
              fileId: part.fileId,
              name: part.name,
              mime: part.mime,
              runId: m.runId,
              at: iso(m.createdAt),
            },
          ]
        : [],
    ),
  );
  if (generated.length > 0) {
    const sizes = new Map(
      (
        await db
          .select({ id: files.id, size: files.size })
          .from(files)
          .where(
            inArray(
              files.id,
              generated.map((g) => g.fileId),
            ),
          )
      ).map((f) => [f.id, f.size]),
    );
    for (const g of generated) {
      outputs.push({
        kind: isRasterImageMime(g.mime) ? 'image' : 'file',
        runId: g.runId,
        at: g.at,
        fileId: g.fileId,
        name: g.name,
        mime: g.mime,
        size: sizes.get(g.fileId) ?? 0,
      });
    }
  }

  // Laporan riset yang dijalankan dari percakapan ini (run riset yang terikat ke percakapan).
  const research = await db
    .select({
      id: researchJobs.id,
      runId: researchJobs.runId,
      question: researchJobs.question,
      at: researchJobs.updatedAt,
    })
    .from(researchJobs)
    .where(and(inArray(researchJobs.runId, runIds), eq(researchJobs.status, 'completed')));
  for (const job of research)
    if (job.runId)
      outputs.push({
        kind: 'research',
        runId: job.runId,
        at: iso(job.at),
        researchId: job.id,
        title: job.question.slice(0, 300),
      });

  // Usulan skill dari agent di percakapan ini (P11): kartu "Usulan skill" di bagian Output.
  const proposals = await db
    .select({
      id: skillProposals.id,
      runId: skillProposals.runId,
      name: skillProposals.name,
      kind: skillProposals.kind,
      status: skillProposals.status,
      at: skillProposals.createdAt,
    })
    .from(skillProposals)
    .where(inArray(skillProposals.runId, runIds));
  for (const p of proposals)
    if (p.runId)
      outputs.push({
        kind: 'skill_proposal',
        runId: p.runId,
        at: iso(p.at),
        proposalId: p.id,
        name: p.name.slice(0, 80),
        proposalKind: p.kind,
        status: p.status,
      });

  // Beberapa output bisa punya cap waktu yang persis sama (event dicatat di detik/milidetik yang sama di
  // bawah beban tinggi); tanpa pemecah seri kedua urutannya tidak deterministik antar-panggilan (ketahuan
  // flaky di CI, bukan lokal, karena lebih banyak pekerjaan paralel). Pemecah seri: run lebih baru duluan
  // (byRun terbalik, konsisten dengan "hasil kerja terbaru dulu"), lalu `kind` sebagai jatuhan terakhir.
  outputs.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    const runDiff = byRun(b, a);
    if (runDiff !== 0) return runDiff;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
  return { plan, outputs: outputs.slice(0, PROGRESS_OUTPUTS_MAX), used };
}
