import { Brain } from 'lucide-react';
import { useMemoryProposals } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { useMemoryActions } from '../memory/useMemoryActions';
import { Button } from '../ui/Button';

/**
 * Memori yang disimpan otomatis dari pesan ini (mode auto, BL14) lengkap dengan Urungkan, supaya pemilik bisa
 * membatalkannya langsung di chat. Yang sudah diurungkan tampil dicoret tanpa aksi, sama seperti di layar Memori.
 */
export function MemoryAutoSavedCards({ messageId }: { messageId: string }) {
  const proposals = useMemoryProposals();
  const actions = useMemoryActions();
  const online = useOnline();
  const mine = (proposals.data ?? []).filter(
    (p) => p.messageId === messageId && (p.status === 'auto_saved' || p.status === 'undone'),
  );
  if (mine.length === 0) return null;
  const m = copy.memory;
  const t = copy.chat.autoMemory;
  return (
    <ul aria-label={t.list} className="flex flex-col gap-2">
      {mine.map((p) => {
        const undone = p.status === 'undone';
        return (
          <li
            key={p.id}
            className="flex items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2"
          >
            <Brain
              size={16}
              strokeWidth={1.5}
              aria-hidden="true"
              className="shrink-0 text-accent"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={`text-ui whitespace-pre-wrap ${undone ? 'text-text-3 line-through' : 'text-text'}`}
              >
                {p.text}
              </span>
              <span className="text-caption text-text-3">{t.title}</span>
            </span>
            {undone ? (
              <span className="text-meta text-text-2">{m.proposalUndone}</span>
            ) : (
              <Button
                variant="secondary"
                disabled={!online || actions.busy !== null}
                onClick={() => void actions.undoProposal(p.id)}
              >
                {m.proposalUndo}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
