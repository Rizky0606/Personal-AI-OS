import type { Memory } from '@aios/contracts';
import { MEMORY_TEXT_MAX } from '@aios/contracts';
import { useRef, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useMemories } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StateView, type ViewState } from '../ui/StateView';
import { Switch } from '../ui/Switch';
import { TextArea } from '../ui/TextArea';
import { useMemoryActions } from './useMemoryActions';

/**
 * Memori yang terlihat (W17): fakta tentang pemilik yang ikut di setiap pesan sistem. Bisa ditambah, diubah di
 * tempat, dinonaktifkan tanpa dihapus, atau dihapus.
 */
export function MemorySection() {
  const query = useMemories();
  const online = useOnline();
  const actions = useMemoryActions();
  const [draft, setDraft] = useState('');
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [toDelete, setToDelete] = useState<Memory | null>(null);
  const items = query.data ?? [];
  const m = copy.memory;

  const view: ViewState = query.isPending
    ? 'loading'
    : query.isError && !query.data
      ? online
        ? 'error'
        : 'offline'
      : items.length === 0
        ? 'empty'
        : 'content';

  async function add() {
    if (!draft.trim()) return;
    if (await actions.create(draft)) setDraft('');
  }

  return (
    <section aria-labelledby="settings-memory" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="settings-memory" className="text-ui font-semibold text-text">
          {m.title}
        </h3>
        <p className="text-meta text-text-2">{m.intro}</p>
      </div>

      <div className="flex flex-col gap-2">
        <TextArea
          label={m.addLabel}
          hint={m.counter(draft.trim().length, MEMORY_TEXT_MAX)}
          value={draft}
          ref={draftRef}
          rows={2}
          maxLength={MEMORY_TEXT_MAX}
          placeholder={m.placeholder}
          disabled={!online || actions.busy === 'create'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void add();
            }
          }}
        />
        <div>
          <Button
            variant="primary"
            disabled={!online || !draft.trim() || actions.busy === 'create'}
            onClick={() => void add()}
          >
            {actions.busy === 'create' ? m.saving : m.add}
          </Button>
        </div>
      </div>

      <StateView
        state={view}
        loadingLabel={m.loading}
        emptyMessage={m.empty}
        emptyAction={
          <Button variant="secondary" onClick={() => draftRef.current?.focus()}>
            {m.addAction}
          </Button>
        }
        errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
      >
        <ul aria-label={m.listLabel} className="flex flex-col rounded-control border border-border">
          {items.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              disabled={!online || actions.busy !== null}
              onToggle={(enabled) => void actions.setEnabled(memory.id, enabled)}
              onSave={(text) => actions.edit(memory.id, text)}
              onDelete={() => setToDelete(memory)}
            />
          ))}
        </ul>
      </StateView>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={m.deleteTitle}
        body={toDelete ? m.deleteBody(toDelete.text) : ''}
        confirmLabel={m.delete}
        cancelLabel={copy.chat.cancel}
        destructive
        onConfirm={() => {
          if (toDelete) void actions.remove(toDelete.id);
          setToDelete(null);
        }}
      />
    </section>
  );
}

interface MemoryRowProps {
  memory: Memory;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onSave: (text: string) => Promise<boolean>;
  onDelete: () => void;
}

function MemoryRow({ memory, disabled, onToggle, onSave, onDelete }: MemoryRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memory.text);
  const m = copy.memory;

  async function save() {
    if (!value.trim()) return;
    if (await onSave(value)) setEditing(false);
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-b-0">
      {editing ? (
        <>
          <TextArea
            label={m.editLabel}
            value={value}
            rows={2}
            maxLength={MEMORY_TEXT_MAX}
            autoFocus
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false);
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void save();
              }
            }}
          />
          <div className="flex gap-2">
            <Button variant="ghost" disabled={disabled} onClick={() => setEditing(false)}>
              {copy.chat.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={disabled || !value.trim()}
              onClick={() => void save()}
            >
              {m.saveEdit}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3">
          <p
            className={cn(
              'min-w-0 flex-1 text-ui whitespace-pre-wrap',
              memory.enabled ? 'text-text' : 'text-text-3 line-through',
            )}
          >
            {memory.text}
          </p>
          <Switch
            checked={memory.enabled}
            label={m.toggle(memory.text)}
            disabled={disabled}
            onChange={onToggle}
          />
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setValue(memory.text);
              setEditing(true);
            }}
          >
            {m.edit}
          </Button>
          <Button variant="ghost" disabled={disabled} onClick={onDelete}>
            {m.delete}
          </Button>
        </div>
      )}
    </li>
  );
}
