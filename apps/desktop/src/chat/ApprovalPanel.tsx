import { ShieldAlert } from 'lucide-react';
import { copy } from '../copy';
import type { PendingApproval } from '../realtime/liveRun';
import { Button } from '../ui/Button';

export interface ApprovalPanelProps {
  approval: PendingApproval;
  /** Keputusan sedang dikirim; tombol dinonaktifkan supaya tidak terkirim dua kali. */
  busy: boolean;
  onResolve: (decision: 'allow' | 'deny', remember: boolean) => void;
}

/**
 * Panel inline berwarna `warning` (DESIGN_SYSTEM.md: Permintaan izin): perintah persis dan folder kerjanya,
 * lalu tiga pilihan. Satu tombol primer (Izinkan sekali); "Selalu" hanya untuk perintah yang persis sama.
 */
export function ApprovalPanel({ approval, busy, onResolve }: ApprovalPanelProps) {
  const title = copy.approval.title[approval.kind];
  return (
    <section
      role="group"
      data-approval-panel=""
      aria-label={title}
      className="flex max-w-[72ch] flex-col gap-3 rounded-panel border border-warning bg-surface p-3"
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
          {copy.approval.allowAlways}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => onResolve('deny', false)}>
          {copy.approval.deny}
        </Button>
      </div>
      {approval.kind === 'command' ? (
        <p className="text-caption text-text-3">{copy.approval.alwaysHint}</p>
      ) : null}
    </section>
  );
}
