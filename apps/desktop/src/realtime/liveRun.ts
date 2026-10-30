import { TERMINAL_RUN_STATUSES, type RunStatus, type ServerEvent } from '@aios/contracts';

export interface ToolStep {
  id: string;
  /** Kosong bila tool.finished tiba sebelum tool.started (event tidak berurutan); dilengkapi saat started datang. */
  name: string;
  target: string | undefined;
  status: 'running' | 'ok' | 'error' | 'denied' | 'cancelled';
  durationMs: number | undefined;
  /** Waktu event mulai (ms epoch, dari envelope); null bila tidak diketahui. */
  startedAt: number | null;
  /** Baris output terbaru untuk aktivitas live. */
  output?: string;
}

export interface LiveSource {
  id: string;
  title: string;
  url: string;
}

export interface LiveProgress {
  stage: string | null;
  progress: number;
  message: string | undefined;
}

export interface PendingApproval {
  approvalId: string;
  kind: 'command' | 'file_write' | 'network';
  /** Perintah, path, atau URL persis yang diminta agent. */
  detail: string;
  cwd: string | undefined;
  toolCallId: string | undefined;
}

export interface RunFailure {
  code: string;
  message: string;
  retryable: boolean;
}

/** Keadaan satu run yang sedang (atau baru saja) mengalir lewat WebSocket. Murni, tanpa React. */
export interface LiveRun {
  runId: string;
  role: string | null;
  status: RunStatus;
  /** ID pesan asisten, diketahui dari delta pertama. */
  messageId: string | null;
  text: string;
  reasoning: string;
  /** Judul ringkas dari mesin (`reasoning.summary`); null bila mesin tidak mengirimnya. */
  reasoningSummary: string | null;
  tools: ToolStep[];
  sources: LiveSource[];
  approvals: PendingApproval[];
  research: LiveProgress;
  error: RunFailure | null;
  /** Waktu event pertama yang terlihat atau waktu run dibuat di server, yang lebih awal (ms epoch). */
  startedAt: number | null;
  /** Waktu aktivitas berakhir: run.completed, error, atau status selesai pertama. Elapsed berhenti di sini. */
  endedAt: number | null;
  lastEventAt: number | null;
  /** Aktivitas terbaru, untuk membedakan menalar, menulis, dan memutuskan langkah berikutnya. */
  lastActivity: 'reasoning' | 'text' | 'tool' | null;
}

export const isTerminal = (status: RunStatus): boolean => TERMINAL_RUN_STATUSES.includes(status);

/**
 * Tidak ada lagi aktivitas yang ditunggu dari mesin: status final, atau `needs_review` (run coding selesai dan
 * menunggu tinjauan manusia, bukan status final di diagram tetapi tidak ada yang mengalir lagi).
 */
export const isSettled = (status: RunStatus): boolean =>
  isTerminal(status) || status === 'needs_review';

export const newLiveRun = (runId: string): LiveRun => ({
  runId,
  role: null,
  status: 'queued',
  messageId: null,
  text: '',
  reasoning: '',
  reasoningSummary: null,
  tools: [],
  sources: [],
  approvals: [],
  research: { stage: null, progress: 0, message: undefined },
  error: null,
  startedAt: null,
  endedAt: null,
  lastEventAt: null,
  lastActivity: null,
});

/** Memajukan waktu mulai ke waktu run dibuat di server bila lebih awal (reload di tengah run). */
export function withRunStart(run: LiveRun, createdAt: number): LiveRun {
  if (!Number.isFinite(createdAt)) return run;
  if (run.startedAt !== null && run.startedAt <= createdAt) return run;
  return { ...run, startedAt: createdAt };
}

/**
 * Menerapkan satu event; event yang tidak relevan untuk tampilan mengembalikan objek yang sama.
 * `ts` (ms epoch, dari envelope) mengisi waktu mulai/selesai dan waktu tiap tool; tanpa `ts` waktu tidak diisi.
 */
export function reduceLiveRun(run: LiveRun, event: ServerEvent, ts?: number): LiveRun {
  const next = reduceEvent(run, event, ts);
  if (ts === undefined || !Number.isFinite(ts)) return next;
  const stamped: LiveRun = {
    ...next,
    startedAt: next.startedAt === null ? ts : Math.min(next.startedAt, ts),
    lastEventAt: next.lastEventAt === null ? ts : Math.max(next.lastEventAt, ts),
  };
  const ends =
    event.type === 'run.completed' ||
    event.type === 'error' ||
    (event.type === 'run.status' && isSettled(event.status));
  return ends && stamped.endedAt === null ? { ...stamped, endedAt: ts } : stamped;
}

function reduceEvent(run: LiveRun, event: ServerEvent, ts: number | undefined): LiveRun {
  const at = ts !== undefined && Number.isFinite(ts) ? ts : null;
  switch (event.type) {
    case 'run.status':
      return { ...run, status: event.status };
    case 'route.decided':
      return { ...run, role: event.role };
    case 'message.delta':
      return {
        ...run,
        messageId: event.messageId,
        text: run.text + event.text,
        lastActivity: 'text',
      };
    case 'reasoning.delta':
      return {
        ...run,
        messageId: run.messageId ?? event.messageId,
        reasoning: run.reasoning + event.text,
        lastActivity: 'reasoning',
      };
    case 'reasoning.summary':
      return {
        ...run,
        messageId: run.messageId ?? event.messageId,
        reasoningSummary: event.text,
      };
    case 'tool.started': {
      const existing = run.tools.find((t) => t.id === event.toolCallId);
      if (!existing) {
        return {
          ...run,
          lastActivity: 'tool',
          tools: [
            ...run.tools,
            {
              id: event.toolCallId,
              name: event.name,
              target: event.target,
              status: 'running',
              durationMs: undefined,
              startedAt: at,
            },
          ],
        };
      }
      // Diputar ulang atau melengkapi tool.finished yang datang lebih dulu: posisi dan status akhir dipertahankan.
      return {
        ...run,
        lastActivity: 'tool',
        tools: run.tools.map((t) =>
          t.id === event.toolCallId
            ? {
                ...t,
                name: event.name,
                target: event.target ?? t.target,
                startedAt: t.startedAt ?? at,
              }
            : t,
        ),
      };
    }
    case 'tool.output': {
      const output = event.chunk.split(/\r?\n/).filter(Boolean).at(-1);
      if (!output) return run;
      return {
        ...run,
        lastActivity: 'tool',
        tools: run.tools.map((tool) =>
          tool.id === event.toolCallId ? { ...tool, output } : tool,
        ),
      };
    }
    case 'tool.finished': {
      const exists = run.tools.some((t) => t.id === event.toolCallId);
      return {
        ...run,
        lastActivity: 'tool',
        tools: exists
          ? run.tools.map((t) =>
              t.id === event.toolCallId
                ? { ...t, status: event.status, durationMs: event.durationMs }
                : t,
            )
          : [
              ...run.tools,
              {
                id: event.toolCallId,
                name: '',
                target: undefined,
                status: event.status,
                durationMs: event.durationMs,
                startedAt: null,
              },
            ],
      };
    }
    case 'approval.requested':
      return {
        ...run,
        approvals: [
          ...run.approvals.filter((a) => a.approvalId !== event.approvalId),
          {
            approvalId: event.approvalId,
            kind: event.kind,
            detail: event.detail,
            cwd: event.cwd,
            toolCallId: event.toolCallId,
          },
        ],
      };
    case 'approval.resolved':
      return { ...run, approvals: run.approvals.filter((a) => a.approvalId !== event.approvalId) };
    case 'research.progress':
      return {
        ...run,
        research: { stage: event.stage, progress: event.progress, message: event.message },
      };
    case 'research.source':
      return run.sources.some((s) => s.id === event.sourceId)
        ? run
        : {
            ...run,
            sources: [...run.sources, { id: event.sourceId, title: event.title, url: event.url }],
          };
    case 'error':
      return {
        ...run,
        error: { code: event.code, message: event.message, retryable: event.retryable },
      };
    default:
      return run;
  }
}
