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
 * Panel inline berwarna `warning` (DESIGN_SYSTEM.md: Permintaan izin): perintah persis dan folder kerjanya,
 * lalu tiga pilihan. Satu tombol primer (Izinkan sekali); "Selalu" hanya untuk perintah yang persis sama,
 * atau untuk semua panggilan tool gateway di project ini.
 */
export function ApprovalPanel({ approval, busy, onResolve }: ApprovalPanelProps) {
  const gatewayTool = aiosToolOf(approval.detail.split('\n')[0] ?? '');
  const title = gatewayTool
    ? copy.approval.gatewayTitle(gatewayTool)
    : copy.approval.title[approval.kind];
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
      <pre
        aria-label={approval.kind === 'command' ? 'Perintah' : 'Detail'}
        className="max-h-48 overflow-auto rounded-control border border-border bg-surface-2 p-2 font-mono text-ui break-all whitespace-pre-wrap text-text"
      >
        {approval.detail}
      </pre>
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
          <Button variant="secondary" disabled={busy} onClick={() => onResolve('allow', false, true)}>
            {copy.approval.allowRunWrites}
          </Button>
        ) : null}
        <Button variant="danger" disabled={busy} onClick={() => onResolve('deny', false)}>
          {copy.approval.deny}
        </Button>
      </div>
      {gatewayTool || approval.kind === 'command' ? (
        <p className="text-caption text-text-3">
          {gatewayTool ? copy.approval.gatewayHint(gatewayTool) : copy.approval.alwaysHint}
        </p>
      ) : null}
    </section>
  );
}
