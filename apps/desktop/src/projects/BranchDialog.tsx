import type { Project } from '@aios/contracts';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api, workerApi } from '../app/services';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { ErrorBanner } from '../ui/ErrorBanner';
import { TextField } from '../ui/TextField';
import { useToastStore } from '../ui/Toaster';

export interface BranchDialogProps {
  /** Project yang branch kerjanya diganti; null = dialog tertutup. */
  project: Project | null;
  /** Folder project di PC ini, bila terikat: daftar branch lokal dibaca dari sana. */
  path: string | null;
  onClose: () => void;
}

/**
 * Ganti branch kerja project: dasar worktree tiap run dan tujuan merge saat review diterima. Branch lokal dibaca
 * worker dari folder project; nama juga bisa diketik (mis. folder belum terikat di PC ini).
 */
export function BranchDialog({ project, path, onClose }: BranchDialogProps) {
  const [value, setValue] = useState('');
  const [branches, setBranches] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();
  const queryClient = useQueryClient();
  const push = useToastStore((s) => s.push);
  const b = copy.projects.branch;

  useEffect(() => {
    if (!project) return;
    setValue(project.defaultBranch);
    setError(null);
    setBranches(null);
    if (!path) return;
    let alive = true;
    workerApi
      .inspect(path)
      .then((inspection) => alive && setBranches(inspection.git.branches))
      .catch(() => alive && setBranches([]));
    return () => {
      alive = false;
    };
  }, [project, path]);

  const name = value.trim();
  const unknown = branches !== null && branches.length > 0 && !branches.includes(name);

  async function save() {
    if (!project || !name || saving) return;
    if (name === project.defaultBranch) return onClose();
    setSaving(true);
    setError(null);
    try {
      await api.updateProject(project.id, { defaultBranch: name });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      push(b.saved(name));
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, online));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-aios-fade bg-bg/60" />
        <Dialog.Content className="fixed top-20 left-1/2 z-50 flex animate-aios-dialog w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-panel border border-border bg-surface p-4 shadow-float">
          <Dialog.Title className="text-section font-semibold text-text">
            {project ? b.title(project.name) : ''}
          </Dialog.Title>
          <Dialog.Description className="text-ui text-text-2">{b.intro}</Dialog.Description>
          {error ? <ErrorBanner message={error} /> : null}
          {path ? (
            branches === null ? (
              <p role="status" className="text-meta text-text-2">
                {b.loading}
              </p>
            ) : branches.length > 0 ? (
              <div role="group" aria-label={b.localBranches} className="flex flex-wrap gap-2">
                {branches.map((branch) => (
                  <Chip key={branch} selected={branch === name} onClick={() => setValue(branch)}>
                    {branch}
                  </Chip>
                ))}
              </div>
            ) : null
          ) : (
            <p className="text-meta text-text-2">{b.unbound}</p>
          )}
          <TextField
            label={b.label}
            value={value}
            disabled={saving}
            className="font-mono"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
          {unknown ? <p className="text-meta text-warning">{b.notLocal(name)}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={onClose}>
              {copy.chat.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={!online || saving || !name}
              onClick={() => void save()}
            >
              {saving ? b.saving : b.save}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
