import type { TeamDetailSchema } from '@aios/contracts';
import type { z } from 'zod';
import { AgentOrb, type OrbState } from '../chat/AgentOrb';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { useUiStore } from '../state/uiStore';

type TeamDetail = z.infer<typeof TeamDetailSchema>;

/** Status anggota/tugas tim -> fase Orb (mapping lokal: kontrak tim punya status sendiri, bukan ActivityPhase). */
function orbOf(status: string): OrbState {
  if (status === 'queued') return 'idle';
  if (status === 'running') return 'thinking';
  if (status === 'reviewing' || status === 'needs_review') return 'tool';
  if (status === 'completed') return 'done';
  return 'error'; // failed, cancelled, needs_attention
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Menunggu',
  running: 'Berjalan',
  reviewing: 'Ditinjau Lead',
  needs_review: 'Menunggu tinjauan Lead',
  completed: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dihentikan',
  needs_attention: 'Perlu perhatian Anda',
};

function Row({
  title,
  subtitle,
  status,
  onCancel,
  onReview,
}: {
  title: string;
  subtitle: string;
  status: string;
  onCancel?: () => void;
  onReview?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2">
      <AgentOrb state={orbOf(status)} size={16} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-text">{title}</span>
        <span className="truncate text-meta text-text-2">
          {subtitle} · {STATUS_LABEL[status] ?? status}
        </span>
      </div>
      {onReview ? (
        <Button variant="secondary" onClick={onReview}>
          {copy.progress.reviewAction}
        </Button>
      ) : null}
      {onCancel ? (
        <Button variant="secondary" onClick={onCancel}>
          {copy.chat.team.cancelMember}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Pohon Lead -> tugas -> Worker untuk percakapan tim Orca (P7, ORCA_DESIGN.md tugas 8). Ditampilkan di
 * panel Progres SEBAGAI GANTI linimasa biasa saat `conversation.teamId` ada. Output per tugas (diff,
 * commit) dibuka lewat tombol Tinjau yang mengarah ke tab Diff yang sudah ada (bukan UI baru).
 */
export function TeamProgressTree({
  team,
  onCancelMember,
}: {
  team: TeamDetail;
  onCancelMember?: (memberId: string) => void;
}) {
  const openReview = useUiStore((s) => s.openReview);
  const lead = team.members.find((m) => m.role === 'lead');
  const active = !['completed', 'failed', 'cancelled'].includes(team.status);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta text-text-2">
        {copy.progress.team.statusLine(team.status)}
        {team.cancelRequestedAt ? ` · ${copy.progress.team.cancelRequested}` : ''}
      </p>
      <ul className="flex flex-col gap-2">
        {lead ? (
          <Row
            title={copy.progress.team.leadTitle}
            subtitle={team.prompt.slice(0, 80)}
            status={lead.status}
          />
        ) : null}
        {team.assignments.map((a) => {
          const member = team.members.find((m) => m.id === a.workerMemberId);
          return (
            <Row
              key={a.id}
              title={a.title}
              subtitle={copy.progress.team.attempt(a.attempt, a.maxAttempts)}
              status={a.status === 'needs_review' ? 'reviewing' : a.status}
              {...(a.resultRef && member ? { onReview: () => openReview(member.runId) } : {})}
              {...(member &&
              active &&
              !['completed', 'failed', 'cancelled'].includes(member.status) &&
              onCancelMember
                ? { onCancel: () => onCancelMember(member.id) }
                : {})}
            />
          );
        })}
      </ul>
      {team.assignments.length === 0 ? (
        <p className={cn('text-ui text-text-2')}>{copy.progress.team.planning}</p>
      ) : null}
    </div>
  );
}
