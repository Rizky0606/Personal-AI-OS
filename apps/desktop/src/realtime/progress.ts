import {
  isRasterImageMime,
  type ConversationProgress,
  type ProgressOutput,
  type TodoPhase,
} from '@aios/contracts';
import {
  buildActivity,
  savedActivity,
  toolKindOf,
  type ActivityStep,
  type SavedTool,
} from './activity';
import type { LiveRun } from './liveRun';

/**
 * Lapisan data panel Progres (tanpa React, tanpa jam): menggabungkan agregat tersimpan dari
 * `GET /conversations/:id/progress` dengan run yang sedang mengalir (todo.updated, artifact.created, context.used,
 * tool.started) tanpa duplikasi. Hasilnya sama persis dengan fixture emas `packages/contracts/fixtures/progress`
 * (dipakai Android di P6). "Sekarang" selalu dari pemanggil.
 */

export type StepState = 'done' | 'active' | 'pending' | 'blocked' | 'abandoned';

export interface ProgressStep {
  id: string;
  label: string;
  state: StepState;
  /** Alasan langkah terhambat (status blocked) atau gagal (langkah turunan dari tool yang galat). */
  blocker?: string;
  /** Nama tahap; hanya pada langkah pertama sebuah tahap, dan hanya bila ada lebih dari satu tahap. */
  phase?: string;
}

export interface ProgressChip {
  /** Nomor langkah yang sedang dikerjakan (mulai 1). */
  current: number;
  /** Total langkah rencana; null bila tidak ada rencana (mesin tanpa tool todo): tidak pernah dikarang. */
  total: number | null;
  label: string;
}

/** Jenis alat yang ditampilkan di "Digunakan dalam sesi ini". */
export type ToolGroup = 'web' | 'browser' | 'terminal' | 'files' | 'subagent';

export interface ProgressUsed {
  uploads: { fileId: string; name: string }[];
  skills: string[];
  memory: { read: number; items: { id: string; title: string }[] };
  engine: string | null;
  model: string | null;
  tools: ToolGroup[];
  /** Konektor MCP (nama tool `mcp__…`), hanya bila ada datanya. */
  connectors: string[];
}

export interface ProgressView {
  hasPlan: boolean;
  steps: ProgressStep[];
  chip: ProgressChip | null;
  outputs: ProgressOutput[];
  used: ProgressUsed;
}

export interface ProgressOptions {
  /** Langkah tool tersimpan di pesan, untuk langkah turunan setelah muat ulang pada mesin tanpa rencana. */
  savedTools?: SavedTool[];
}

const TOOL_GROUP: Partial<Record<NonNullable<ReturnType<typeof toolKindOf>>, ToolGroup>> = {
  web: 'web',
  browser: 'browser',
  command: 'terminal',
  read: 'files',
  edit: 'files',
  search: 'files',
  subagent: 'subagent',
};
const TOOL_GROUP_ORDER: ToolGroup[] = ['web', 'browser', 'terminal', 'files', 'subagent'];

const union = <T>(base: readonly T[], extra: readonly T[], key: (item: T) => string): T[] => {
  const seen = new Set(base.map(key));
  return [...base, ...extra.filter((item) => !seen.has(key(item)))];
};

function planSteps(phases: readonly TodoPhase[]): ProgressStep[] {
  const named = phases.length > 1;
  return phases.flatMap((phase, p) =>
    phase.tasks.map((task, t): ProgressStep => {
      const state: StepState =
        task.status === 'completed'
          ? 'done'
          : task.status === 'in_progress'
            ? 'active'
            : task.status === 'blocked'
              ? 'blocked'
              : task.status === 'abandoned'
                ? 'abandoned'
                : 'pending';
      return {
        id: `p${p}-${t}`,
        label: task.content,
        state,
        ...(task.blocker ? { blocker: task.blocker } : {}),
        ...(named && t === 0 && phase.name ? { phase: phase.name } : {}),
      };
    }),
  );
}

/** Langkah turunan dari langkah tool (mesin tanpa rencana): label kalimat langkah, target redup di UI lewat id. */
function derivedSteps(steps: readonly ActivityStep[]): ProgressStep[] {
  return steps.map((step): ProgressStep => {
    const state: StepState =
      step.status === 'running'
        ? 'active'
        : step.status === 'ok'
          ? 'done'
          : step.status === 'error'
            ? 'blocked'
            : 'abandoned';
    return {
      id: step.id,
      label: step.target ? `${step.label} ${step.target}` : step.label,
      state,
      ...(step.status === 'error' ? { blocker: step.label } : {}),
    };
  });
}

function chipOf(steps: ProgressStep[], hasPlan: boolean): ProgressChip | null {
  if (steps.length === 0) return null;
  if (!hasPlan) {
    return { current: steps.length, total: null, label: steps[steps.length - 1]!.label };
  }
  const active = steps.findIndex((s) => s.state === 'active');
  const blocked = steps.findIndex((s) => s.state === 'blocked');
  const settled = steps.filter((s) => s.state === 'done' || s.state === 'abandoned').length;
  const index = active >= 0 ? active : blocked >= 0 ? blocked : Math.min(settled, steps.length - 1);
  return { current: index + 1, total: steps.length, label: steps[index]!.label };
}

export function buildProgress(
  response: ConversationProgress | null | undefined,
  live: LiveRun | undefined,
  now: number,
  options: ProgressOptions = {},
): ProgressView {
  // Rencana: yang dari run yang sedang mengalir lebih baru daripada yang tersimpan.
  const phases = live?.todos.length ? live.todos : (response?.plan?.phases ?? []);
  const hasPlan = phases.some((phase) => phase.tasks.length > 0);
  const steps = hasPlan
    ? planSteps(phases)
    : derivedSteps(
        live ? buildActivity(live, now).steps : savedActivity(options.savedTools ?? [], null).steps,
      );

  // Hasil kerja: artifact yang baru tiba di run live (belum ada di agregat) berada paling atas.
  const stored = response?.outputs ?? [];
  const storedFiles = new Set(
    stored.flatMap((o) => (o.kind === 'image' || o.kind === 'file' ? [o.fileId] : [])),
  );
  const fresh: ProgressOutput[] = (live?.artifacts ?? [])
    .filter((a) => !storedFiles.has(a.fileId))
    .reverse()
    .map((a) => ({
      kind: isRasterImageMime(a.mime) ? ('image' as const) : ('file' as const),
      runId: live!.runId,
      at: new Date(now).toISOString(),
      fileId: a.fileId,
      name: a.name,
      mime: a.mime,
      size: a.size,
    }));
  const outputs = [...fresh, ...stored];

  // Digunakan: gabungan tersimpan dan live; engine, model, dan memori mengikuti run terbaru.
  const context = live?.contextUsed ?? null;
  const base = response?.used;
  const toolNames = union(
    base?.tools ?? [],
    (live?.tools ?? []).map((t) => t.name).filter(Boolean),
    (n) => n,
  );
  const groups = new Set<ToolGroup>();
  const connectors: string[] = [];
  for (const name of toolNames) {
    if (name.startsWith('mcp__')) {
      connectors.push(name.split('__')[1] ?? name);
      continue;
    }
    const kind = toolKindOf(name);
    const group = kind ? TOOL_GROUP[kind] : undefined;
    if (group) groups.add(group);
  }
  const used: ProgressUsed = {
    uploads: union(
      (base?.attachments ?? []).map((a) => ({ fileId: a.fileId, name: a.name })),
      (context?.attachments ?? []).map((a) => ({ fileId: a.fileId, name: a.name })),
      (a) => a.fileId,
    ),
    skills: union(base?.skills ?? [], context?.skills ?? [], (s) => s),
    memory: context
      ? { read: context.memory.read, items: context.memory.items ?? [] }
      : (base?.memory ?? { read: 0, items: [] }),
    engine: context?.engine ?? base?.engine ?? null,
    model: context ? context.model : (base?.model ?? null),
    tools: TOOL_GROUP_ORDER.filter((g) => groups.has(g)),
    connectors: [...new Set(connectors)],
  };

  return { hasPlan, steps, chip: chipOf(steps, hasPlan), outputs, used };
}
