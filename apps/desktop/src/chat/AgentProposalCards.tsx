import { CalendarClock, Kanban } from 'lucide-react';
import { AfterWebNote } from '../agentProposals/AfterWebNote';
import { useOpenAgentProposal } from '../agentProposals/useOpenAgentProposal';
import { useAgentProposals } from '../api/queries';
import { copy } from '../copy';
import { Button } from '../ui/Button';

/**
 * Kartu kecil di bawah jawaban agent yang mengusulkan kartu kanban atau jadwal (BL909). Hanya tombol Tinjau:
 * keputusan setuju/tolak selalu di papan Kanban atau layar Jadwal, bukan di sini.
 */
export function AgentProposalCards({
  conversationId,
  runId,
}: {
  conversationId: string;
  runId: string | null;
}) {
  const proposals = useAgentProposals({ status: 'all', conversationId });
  const open = useOpenAgentProposal();
  const mine = runId === null ? [] : (proposals.data ?? []).filter((p) => p.runId === runId);
  if (mine.length === 0) return null;
  const t = copy.chat.agentProposal;
  return (
    <ul aria-label={t.list} className="flex flex-col gap-2">
      {mine.map((p) => {
        const name = p.kind === 'task' ? p.task.title : p.schedule.name;
        const Icon = p.kind === 'task' ? Kanban : CalendarClock;
        return (
          <li
            key={p.id}
            className="flex flex-col gap-2 rounded-control border border-border bg-surface-2 px-3 py-2"
          >
            <span className="flex items-center gap-3">
              <Icon
                size={16}
                strokeWidth={1.5}
                aria-hidden="true"
                className="shrink-0 text-accent"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui text-text">
                  {p.kind === 'task' ? t.cardTask(name) : t.cardSchedule(name)}
                </span>
                <span className="text-caption text-text-3">{t.status[p.status]}</span>
              </span>
              <Button variant="secondary" aria-label={t.reviewLabel(name)} onClick={() => open(p)}>
                {t.review}
              </Button>
            </span>
            {p.afterWeb ? <AfterWebNote /> : null}
          </li>
        );
      })}
    </ul>
  );
}
