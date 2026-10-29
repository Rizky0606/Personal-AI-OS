import type { Task } from '@aios/contracts';
import { useState } from 'react';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { taskErrorMessage } from './errors';
import { Markdown } from '../markdown/Markdown';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { DialogFrame } from '../screens/DialogFrame';
import { TextArea } from '../ui/TextArea';
import { TextField } from '../ui/TextField';
import { isEditable, isQueued } from './board';

export interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kartu yang diubah; kosong = kartu baru. */
  task?: Task | undefined;
  onSave: (input: { title: string; body: string; agentRole: string | null }) => Promise<void>;
}

/**
 * Kartu baru atau ubah kartu. Deskripsi Markdown dengan pratinjau. Kartu yang sedang dikerjakan atau
 * menunggu tinjauan hanya bisa dilihat.
 */
export function TaskDialog({ open, onOpenChange, task, onSave }: TaskDialogProps) {
  const online = useOnline();
  const [title, setTitle] = useState(task?.title ?? '');
  const [body, setBody] = useState(task?.body ?? '');
  const [preview, setPreview] = useState(false);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const d = copy.kanban.dialog;
  const readOnly = task !== undefined && (!isEditable(task) || isQueued(task));

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
        agentRole: task?.agentRole ?? null,
      });
      onOpenChange(false);
    } catch (e) {
      setError(taskErrorMessage(e, online));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={!task ? d.createTitle : readOnly ? d.viewTitle : d.editTitle}
      size="md"
      closeLabel={d.close}
      footer={
        readOnly ? undefined : (
          <>
            <Button variant="secondary" onClick={() => setPreview((p) => !p)}>
              {preview ? d.write : d.preview}
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? d.saving : d.save}
            </Button>
          </>
        )
      }
    >
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
    </DialogFrame>
  );
}
