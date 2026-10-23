import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { RoleInfo, TaskProposal } from '../api/gateway';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { taskErrorMessage } from './errors';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { IconButton } from '../ui/IconButton';
import { TextArea } from '../ui/TextArea';

export interface BreakdownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  roles: RoleInfo[];
  /** Menyimpan kartu terpilih ke Backlog, sesuai urutan usulan. */
  onSave: (proposals: TaskProposal[]) => Promise<void>;
}

/** Tulis ide, AI mengusulkan kartu beserta role, pengguna memilih yang disimpan. Tidak ada yang tersimpan sebelum dipilih. */
export function BreakdownDialog({
  open,
  onOpenChange,
  projectId,
  roles,
  onSave,
}: BreakdownDialogProps) {
  const online = useOnline();
  const [idea, setIdea] = useState('');
  const [ideaError, setIdeaError] = useState<string | undefined>();
  const [proposals, setProposals] = useState<TaskProposal[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [working, setWorking] = useState<'propose' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = copy.kanban.breakdownDialog;

  function change(next: boolean) {
    if (!next) {
      setIdea('');
      setProposals(null);
      setPicked(new Set());
      setError(null);
      setIdeaError(undefined);
      setWorking(null);
    }
    onOpenChange(next);
  }

  async function propose() {
    if (working) return;
    if (!idea.trim()) {
      setIdeaError(d.emptyIdea);
      return;
    }
    setIdeaError(undefined);
    setError(null);
    setWorking('propose');
    try {
      const items = await api.breakdownTasks(projectId, idea.trim());
      setProposals(items);
      setPicked(new Set(items.map((_, i) => i)));
    } catch (e) {
      setError(taskErrorMessage(e, online));
    } finally {
      setWorking(null);
    }
  }

  async function save() {
    if (!proposals || working) return;
    if (picked.size === 0) {
      setError(d.none);
      return;
    }
    setError(null);
    setWorking('save');
    try {
      await onSave(proposals.filter((_, i) => picked.has(i)));
      change(false);
    } catch (e) {
      setError(taskErrorMessage(e, online));
      setWorking(null);
    }
  }

  const toggle = (index: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-20 left-1/2 z-50 flex max-h-[calc(100vh-10rem)] w-[min(600px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-4 overflow-y-auto rounded-panel border border-border bg-surface p-4 shadow-float"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-section font-semibold text-text">{d.title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={copy.kanban.dialog.close}>
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>

          {error ? <ErrorBanner message={error} /> : null}

          {proposals === null ? (
            <>
              <TextArea
                label={d.idea}
                hint={d.ideaHint}
                rows={5}
                value={idea}
                error={ideaError}
                onChange={(e) => setIdea(e.target.value)}
              />
              <div className="flex items-center justify-end gap-3">
                {working === 'propose' ? (
                  <span role="status" className="text-meta text-text-2">
                    {d.proposing}
                  </span>
                ) : null}
                <Button
                  variant="primary"
                  disabled={working !== null}
                  onClick={() => void propose()}
                >
                  {d.propose}
                </Button>
              </div>
            </>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-meta text-text-2">{d.pick}</legend>
                {proposals.map((item, index) => (
                  <label
                    // Usulan tidak punya id; urutannya tetap selama dialog terbuka.
                    key={index}
                    className="flex cursor-pointer items-start gap-3 rounded-control border border-border bg-surface p-3 hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(index)}
                      onChange={() => toggle(index)}
                      className="mt-1 accent-accent"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-ui font-medium text-text">{item.title}</span>
                      {item.body ? (
                        <span className="line-clamp-3 text-meta whitespace-pre-line text-text-2">
                          {item.body}
                        </span>
                      ) : null}
                      <span className="text-caption text-text-3">
                        {roles.find((r) => r.id === item.agentRole)?.name ?? copy.kanban.role.auto}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={working !== null}
                  onClick={() => {
                    setProposals(null);
                    setError(null);
                  }}
                >
                  {d.back}
                </Button>
                <Button variant="primary" disabled={working !== null} onClick={() => void save()}>
                  {d.save(picked.size)}
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
