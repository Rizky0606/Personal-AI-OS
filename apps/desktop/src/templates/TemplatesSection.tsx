import { PROMPT_TEMPLATE_BODY_MAX, type PromptTemplate } from '@aios/contracts';
import { useRef, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { usePromptTemplates } from '../api/queries';
import { useOnline } from '../app/hooks';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { StateView, type ViewState } from '../ui/StateView';
import { TextArea } from '../ui/TextArea';
import { TextField } from '../ui/TextField';
import { useTemplateActions } from './useTemplateActions';

/**
 * Templat prompt (W27): prompt tersimpan yang dipanggil dengan `/nama` di kolom pesan. `{{parameter}}` di isinya
 * ditanyakan saat dipakai.
 */
export function TemplatesSection() {
  const query = usePromptTemplates();
  const online = useOnline();
  const actions = useTemplateActions();
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [toDelete, setToDelete] = useState<PromptTemplate | null>(null);
  const items = query.data ?? [];
  const t = copy.templates;

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
    if (!name.trim() || !body.trim()) return;
    if (await actions.create(name, body)) {
      setName('');
      setBody('');
    }
  }

  return (
    <section aria-labelledby="settings-templates" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="settings-templates" className="text-section font-semibold text-text">
          {t.title}
        </h2>
        <p className="text-meta text-text-2">{t.intro}</p>
      </div>

      <div className="flex flex-col gap-2">
        <TextField
          label={t.nameLabel}
          hint={t.nameHint}
          ref={nameRef}
          value={name}
          maxLength={40}
          placeholder={t.namePlaceholder}
          disabled={!online || actions.busy === 'create'}
          onChange={(event) => setName(event.target.value)}
        />
        <TextArea
          label={t.bodyLabel}
          hint={t.counter(body.trim().length, PROMPT_TEMPLATE_BODY_MAX)}
          value={body}
          rows={3}
          maxLength={PROMPT_TEMPLATE_BODY_MAX}
          placeholder={t.bodyPlaceholder}
          disabled={!online || actions.busy === 'create'}
          onChange={(event) => setBody(event.target.value)}
        />
        <div>
          <Button
            variant="primary"
            disabled={!online || !name.trim() || !body.trim() || actions.busy === 'create'}
            onClick={() => void add()}
          >
            {actions.busy === 'create' ? t.saving : t.add}
          </Button>
        </div>
      </div>

      <StateView
        state={view}
        loadingLabel={t.loading}
        emptyMessage={t.empty}
        emptyAction={
          <Button variant="secondary" onClick={() => nameRef.current?.focus()}>
            {t.createAction}
          </Button>
        }
        errorMessage={query.isError ? apiErrorMessage(query.error, online) : ''}
        offlineMessage={copy.states.offline}
        retryLabel={copy.states.retry}
        onRetry={() => void query.refetch()}
      >
        <ul aria-label={t.listLabel} className="flex flex-col rounded-control border border-border">
          {items.map((item) => (
            <TemplateRow
              key={item.id}
              template={item}
              disabled={!online || actions.busy !== null}
              onSave={(patch) => actions.edit(item.id, patch)}
              onDelete={() => setToDelete(item)}
            />
          ))}
        </ul>
      </StateView>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t.deleteTitle}
        body={toDelete ? t.deleteBody(toDelete.name) : ''}
        confirmLabel={t.delete}
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

interface TemplateRowProps {
  template: PromptTemplate;
  disabled: boolean;
  onSave: (patch: { name: string; body: string }) => Promise<boolean>;
  onDelete: () => void;
}

function TemplateRow({ template, disabled, onSave, onDelete }: TemplateRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const t = copy.templates;

  async function save() {
    if (!name.trim() || !body.trim()) return;
    if (await onSave({ name, body })) setEditing(false);
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-b-0">
      {editing ? (
        <>
          <TextField
            label={t.nameLabel}
            value={name}
            maxLength={40}
            autoFocus
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
          <TextArea
            label={t.bodyLabel}
            value={body}
            rows={3}
            maxLength={PROMPT_TEMPLATE_BODY_MAX}
            disabled={disabled}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="ghost" disabled={disabled} onClick={() => setEditing(false)}>
              {copy.chat.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={disabled || !name.trim() || !body.trim()}
              onClick={() => void save()}
            >
              {t.saveEdit}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-mono text-ui text-text">/{template.name}</span>
            <p className="line-clamp-3 text-ui whitespace-pre-wrap text-text-2">{template.body}</p>
          </div>
          <Button
            variant="ghost"
            disabled={disabled}
            aria-label={`${t.edit} /${template.name}`}
            onClick={() => {
              setName(template.name);
              setBody(template.body);
              setEditing(true);
            }}
          >
            {t.edit}
          </Button>
          <Button
            variant="ghost"
            disabled={disabled}
            aria-label={`${t.delete} /${template.name}`}
            onClick={onDelete}
          >
            {t.delete}
          </Button>
        </div>
      )}
    </li>
  );
}
