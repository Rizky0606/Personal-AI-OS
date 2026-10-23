import type { Task } from '@aios/contracts';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import type { RoleInfo } from '../api/gateway';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { taskErrorMessage } from './errors';
import { Markdown } from '../markdown/Markdown';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { IconButton } from '../ui/IconButton';
import { RadioMenu } from '../ui/RadioMenu';
import { TextArea } from '../ui/TextArea';
import { TextField } from '../ui/TextField';
import { isEditable, isQueued } from './board';

const AUTO = '__router__';

export interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kartu yang diubah; kosong = kartu baru. */
  task?: Task | undefined;
  roles: RoleInfo[];
  onSave: (input: { title: string; body: string; agentRole: string | null }) => Promise<void>;
}

/**
 * Kartu baru atau ubah kartu. Deskripsi Markdown dengan pratinjau. Kartu yang sedang dikerjakan atau
 * menunggu tinjauan hanya bisa dilihat.
 */
export function TaskDialog({ open, onOpenChange, task, roles, onSave }: TaskDialogProps) {
  const online = useOnline();
  const [title, setTitle] = useState(task?.title ?? '');
  const [body, setBody] = useState(task?.body ?? '');
  const [role, setRole] = useState<string>(task?.agentRole ?? AUTO);
  const [preview, setPreview] = useState(false);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const d = copy.kanban.dialog;
  const readOnly = task !== undefined && (!isEditable(task) || isQueued(task));
  const codingRoles = roles.filter((r) => r.engine === 'omp');
  const roleName = codingRoles.find((r) => r.id === role)?.name ?? copy.kanban.role.auto;

  async function save() {
    if (saving) return;
    if (!title.trim()) {
      setTitleError(d.emptyName);
      return;
    }
    setTitleError(undefined);
    setError(null);
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        body,
        agentRole: role === AUTO ? null : role,
      });
      onOpenChange(false);
    } catch (e) {
      setError(taskErrorMessage(e, online));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-20 left-1/2 z-50 flex max-h-[calc(100vh-10rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-4 overflow-y-auto rounded-panel border border-border bg-surface p-4 shadow-float"
        >
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-section font-semibold text-text">
              {!task ? d.createTitle : readOnly ? d.viewTitle : d.editTitle}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={d.close}>
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>

          {error ? <ErrorBanner message={error} /> : null}
          {readOnly ? <p className="text-meta text-text-2">{d.lockedHint}</p> : null}

          <TextField
            label={d.name}
            value={title}
            error={titleError}
            disabled={readOnly}
            onChange={(e) => setTitle(e.target.value)}
          />

          {preview || readOnly ? (
            <div className="flex flex-col gap-1">
              <span className="text-meta text-text-2">{d.body}</span>
              <div className="min-h-24 rounded-control border border-border bg-surface px-3 py-2">
                {body.trim() ? (
                  <Markdown source={body} />
                ) : (
                  <p className="text-ui text-text-3">{d.noBody}</p>
                )}
              </div>
            </div>
          ) : (
            <TextArea
              label={d.body}
              hint={d.bodyHint}
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}

          <div className="flex items-center justify-between gap-3">
            <RadioMenu
              label={copy.kanban.role.change}
              value={role}
              onValueChange={setRole}
              options={[
                { value: AUTO, label: copy.kanban.role.auto },
                ...codingRoles.map((r) => ({ value: r.id, label: r.name })),
              ]}
              trigger={
                <button
                  type="button"
                  disabled={readOnly}
                  aria-label={`${copy.kanban.role.label}: ${roleName}`}
                  className="flex h-8 items-center gap-2 rounded-control border border-border bg-surface px-2 text-ui text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{roleName}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="text-text-2"
                  />
                </button>
              }
            />
            <div className="flex gap-2">
              {readOnly ? null : (
                <Button variant="secondary" onClick={() => setPreview((p) => !p)}>
                  {preview ? d.write : d.preview}
                </Button>
              )}
              {readOnly ? null : (
                <Button variant="primary" disabled={saving} onClick={() => void save()}>
                  {saving ? d.saving : d.save}
                </Button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
