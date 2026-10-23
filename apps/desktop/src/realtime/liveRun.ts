import { TERMINAL_RUN_STATUSES, type RunStatus, type ServerEvent } from '@aios/contracts';

export interface ToolStep {
  id: string;
  name: string;
  target: string | undefined;
  status: 'running' | 'ok' | 'error' | 'denied' | 'cancelled';
  durationMs: number | undefined;
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
  tools: ToolStep[];
  sources: LiveSource[];
  approvals: PendingApproval[];
  research: LiveProgress;
  error: RunFailure | null;
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
  tools: [],
  sources: [],
  approvals: [],
  research: { stage: null, progress: 0, message: undefined },
  error: null,
});

/** Menerapkan satu event; event yang tidak relevan untuk tampilan mengembalikan objek yang sama. */
export function reduceLiveRun(run: LiveRun, event: ServerEvent): LiveRun {
  switch (event.type) {
    case 'run.status':
      return { ...run, status: event.status };
    case 'route.decided':
      return { ...run, role: event.role };
    case 'message.delta':
      return { ...run, messageId: event.messageId, text: run.text + event.text };
    case 'reasoning.delta':
      return {
        ...run,
        messageId: run.messageId ?? event.messageId,
        reasoning: run.reasoning + event.text,
      };
    case 'tool.started':
      return {
        ...run,
        tools: [
          ...run.tools.filter((t) => t.id !== event.toolCallId),
          {
            id: event.toolCallId,
            name: event.name,
            target: event.target,
            status: 'running',
            durationMs: undefined,
          },
        ],
      };
    case 'tool.finished':
      return {
        ...run,
        tools: run.tools.map((t) =>
          t.id === event.toolCallId
            ? { ...t, status: event.status, durationMs: event.durationMs }
            : t,
        ),
      };
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
