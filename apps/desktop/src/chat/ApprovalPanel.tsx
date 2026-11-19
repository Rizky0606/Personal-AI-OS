import { aiosToolOf } from '@aios/contracts';
import { ShieldAlert } from 'lucide-react';
import { copy } from '../copy';
import type { PendingApproval } from '../realtime/liveRun';
import { Button } from '../ui/Button';

export interface ApprovalPanelProps {
  approval: PendingApproval;
  /** Keputusan sedang dikirim; tombol dinonaktifkan supaya tidak terkirim dua kali. */
  busy: boolean;
  /** `forRun`: "Izinkan tulis berkas untuk run ini" (hanya izin tulis berkas). */
  onResolve: (decision: 'allow' | 'deny', remember: boolean, forRun?: boolean) => void;
}

/**
 * Detail izin tulis berkas dari omp: `Path: x\nContent:\n…` (berkas baru) atau `File: x` (ubah). Keduanya ditampilkan
 * sama: jalur berkas, isi baru bisa dibuka. Null bila bentuknya lain (ditampilkan mentah).
 */
export function fileApproval(detail: string): { path: string; content: string | null } | null {
  const match = /^(?:Path|File): ([^\n]+)(?:\n([\s\S]*))?$/.exec(detail);
  if (!match?.[1]) return null;
  const rest = (match[2] ?? '').replace(/^Content:\n?/, '');
  return { path: match[1].trim(), content: rest.trim() ? rest : null };
}

/**
 * Spawn subagent omp (tool `task`): adapter mengirimnya sebagai `command`, detailnya `Context/Batch agents/Agent/Task`.
 * Null bila bukan permintaan subagent.
 */
export function subagentApproval(detail: string): { agents: string; task: string } | null {
  const agents = (/^Batch agents: (.+)$/m.exec(detail) ?? /^Agent: (.+)$/m.exec(detail))?.[1];
  if (!agents || !/^Task:$/m.test(detail)) return null;
  return { agents: agents.trim(), task: /^Task:\n([\s\S]*)$/m.exec(detail)?.[1]?.trim() ?? '' };
}

/**
 * Panel inline berwarna `warning` (DESIGN_SYSTEM.md: Permintaan izin): perintah persis dan folder kerjanya,
 * lalu tiga pilihan. Satu tombol primer (Izinkan sekali); "Selalu" hanya untuk perintah yang persis sama,
 * untuk semua penulisan berkas di project ini, atau untuk semua panggilan tool gateway di project ini.
 */
export function ApprovalPanel({ approval, busy, onResolve }: ApprovalPanelProps) {
  const gatewayTool = aiosToolOf(approval.detail.split('\n')[0] ?? '');
  const file = approval.kind === 'file_write' ? fileApproval(approval.detail) : null;
  const subagent = approval.kind === 'command' ? subagentApproval(approval.detail) : null;
  const title = gatewayTool
    ? copy.approval.gatewayTitle(gatewayTool)
    : subagent
      ? copy.approval.subagentTitle
      : copy.approval.title[approval.kind];
  const hint = gatewayTool
    ? copy.approval.gatewayHint(gatewayTool)
    : subagent
      ? copy.approval.subagentHint
      : approval.kind === 'file_write'
        ? copy.approval.fileWriteHint
        : approval.kind === 'command'
          ? copy.approval.alwaysHint
          : null;
  return (
    <section
      role="group"
      data-approval-panel=""
      aria-label={title}
      className="ml-10 flex max-w-(--aios-chat-measure) animate-aios-enter flex-col gap-3 rounded-panel border border-warning bg-surface p-4"
    >
      <header className="flex items-center gap-2 text-ui font-medium text-text">
        <ShieldAlert size={16} strokeWidth={1.5} aria-hidden="true" className="text-warning" />
        {title}
      </header>
      {file ? (
        <div className="flex flex-col gap-2 rounded-control border border-border bg-surface-2 p-2">
          <p className="font-mono text-ui break-all text-text">
            <span className="text-text-2">{copy.approval.file}: </span>
            {file.path}
          </p>
          {file.content ? (
            <details>
              <summary className="cursor-pointer text-meta text-text-2">
                {copy.approval.showContent(file.content.trimEnd().split('\n').length)}
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto font-mono text-ui break-all whitespace-pre-wrap text-text">
                {file.content}
              </pre>
            </details>
          ) : null}
        </div>
      ) : subagent ? (
        <div className="flex flex-col gap-1 rounded-control border border-border bg-surface-2 p-2">
          <p className="font-mono text-ui break-all text-text">
            <span className="text-text-2">{copy.approval.subagents}: </span>
            {subagent.agents}
          </p>
          {subagent.task ? (
            <pre
              aria-label={copy.approval.subagentTask}
              className="max-h-48 overflow-auto font-mono text-ui break-all whitespace-pre-wrap text-text"
            >
              {subagent.task}
            </pre>
          ) : null}
        </div>
      ) : (
        <pre
          aria-label={approval.kind === 'command' ? 'Perintah' : 'Detail'}
          className="max-h-48 overflow-auto rounded-control border border-border bg-surface-2 p-2 font-mono text-ui break-all whitespace-pre-wrap text-text"
        >
          {approval.detail}
        </pre>
      )}
      {approval.cwd ? (
        <p className="font-mono text-caption break-all text-text-2">
          {copy.approval.cwd}: {approval.cwd}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => onResolve('allow', false)}>
          {copy.approval.allowOnce}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onResolve('allow', true)}>
          {gatewayTool ? copy.approval.allowAlwaysTool(gatewayTool) : copy.approval.allowAlways}
        </Button>
        {approval.kind === 'file_write' ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onResolve('allow', false, true)}
          >
            {copy.approval.allowRunWrites}
          </Button>
        ) : null}
        <Button variant="danger" disabled={busy} onClick={() => onResolve('deny', false)}>
          {copy.approval.deny}
        </Button>
      </div>
      {hint ? <p className="text-caption text-text-3">{hint}</p> : null}
    </section>
  );
}
