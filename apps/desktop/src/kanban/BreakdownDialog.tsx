import { useState } from 'react';
import type { RoleInfo, TaskProposal } from '../api/gateway';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { copy } from '../copy';
import { taskErrorMessage } from './errors';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { DialogFrame } from '../screens/DialogFrame';
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
    <DialogFrame
      open={open}
      onOpenChange={change}
      title={d.title}
      size="lg"
      closeLabel={copy.kanban.dialog.close}
      footer={
        proposals === null ? (
          <>
            {working === 'propose' ? (
              <span role="status" className="mr-auto self-center text-meta text-text-2">
                {d.proposing}
              </span>
            ) : null}
            <Button variant="primary" disabled={working !== null} onClick={() => void propose()}>
              {d.propose}
            </Button>
          </>
        ) : (
          <>
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
          </>
        )
      }
    >
      {error ? <ErrorBanner message={error} /> : null}

      {proposals === null ? (
        <TextArea
          label={d.idea}
          hint={d.ideaHint}
          rows={5}
          value={idea}
          error={ideaError}
          onChange={(e) => setIdea(e.target.value)}
        />
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-meta text-text-2">{d.pick}</legend>
          {proposals.map((item, index) => (
            <label
              // Usulan tidak punya id; urutannya tetap selama dialog terbuka.
              key={index}
              className="flex cursor-pointer items-start gap-3 rounded-control border border-border bg-surface p-3 transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
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
      )}
    </DialogFrame>
  );
}
