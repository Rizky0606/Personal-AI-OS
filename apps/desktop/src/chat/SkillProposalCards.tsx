import { Sparkles } from 'lucide-react';
import { useSkillProposals } from '../api/queries';
import { copy } from '../copy';
import { useOpenProposal } from '../skills/useOpenProposal';
import { Button } from '../ui/Button';

/**
 * Kartu kecil di bawah jawaban agent yang menyertakan usulan skill (P11). Hanya tombol Tinjau: tidak ada aksi
 * yang mengaktifkan skill dari kartu ini, keputusan selalu di halaman Skill.
 */
export function SkillProposalCards({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) {
  const proposals = useSkillProposals({ status: 'all', conversationId });
  const open = useOpenProposal();
  const mine = (proposals.data ?? []).filter((p) => p.messageId === messageId);
  if (mine.length === 0) return null;
  const t = copy.chat.skillProposal;
  return (
    <ul aria-label={copy.progress.kinds.skill_proposal} className="flex flex-col gap-2">
      {mine.map((p) => (
        <li
          key={p.id}
          className="flex items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2"
        >
          <Sparkles
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className="shrink-0 text-accent"
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-ui text-text">
              {p.kind === 'patch' ? t.cardPatch(p.name) : t.cardNew(p.name)}
            </span>
            <span className="text-caption text-text-3">{t.status[p.status]}</span>
          </span>
          <Button variant="secondary" aria-label={t.reviewLabel(p.name)} onClick={() => open(p.id)}>
            {t.review}
          </Button>
        </li>
      ))}
    </ul>
  );
}
