import type { ModelInfo, RoleInfo } from '../api/gateway';
import { ArrowUp, ChevronDown, Pencil, Square, X } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { copy } from '../copy';
import type { ContextAttachment } from '../state/uiStore';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/IconButton';
import { RadioMenu } from '../ui/RadioMenu';

export const AUTO = '__auto__';

export interface ComposerProps {
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** Jawaban sedang mengalir: tombol kirim berubah menjadi hentikan. */
  streaming: boolean;
  /** Mengirim sedang berlangsung (belum dikonfirmasi server). */
  sending: boolean;
  roles: RoleInfo[];
  /** Null = otomatis oleh router. */
  role: string | null;
  onRole: (role: string | null) => void;
  models: ModelInfo[];
  model: string | null;
  onModel: (model: string | null) => void;
  canEditLast: boolean;
  onEditLast: () => void;
  /** Naik tiap fokus perlu dipindah ke kolom pesan (chat baru, ubah pesan terakhir). */
  focusNonce: number;
  suggestions?: readonly string[];
  /** Konteks dari preview yang ikut terkirim bersama pesan ini. */
  attachments?: readonly ContextAttachment[];
  onRemoveAttachment?: (id: string) => void;
}

const MAX_HEIGHT_PX = 192;

/** Composer langsung siap ketik. Satu tombol primer: Kirim, atau Hentikan saat menjawab. */
export function Composer({
  draft,
  onDraft,
  onSend,
  onStop,
  streaming,
  sending,
  roles,
  role,
  onRole,
  models,
  model,
  onModel,
  canEditLast,
  onEditLast,
  focusNonce,
  suggestions,
  attachments = [],
  onRemoveAttachment,
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();

  useEffect(() => {
    field.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!streaming && !sending) onSend();
  }

  const roleName = role ? (roles.find((r) => r.id === role)?.name ?? role) : copy.chat.role.auto;
  const modelName = model
    ? (models.find((m) => m.id === model)?.label ?? model)
    : copy.chat.model.auto;
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <div className="shrink-0 border-t border-border bg-bg px-8 pt-3 pb-3">
      <div className="mx-auto flex max-w-[calc(72ch+4rem)] flex-col gap-2">
        {suggestions && suggestions.length > 0 && draft === '' ? (
          <div
            role="group"
            aria-label={copy.chat.suggestionsLabel}
            className="flex flex-wrap gap-2"
          >
            {suggestions.map((text) => (
              <Chip key={text} onClick={() => onDraft(text)}>
                {text}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-2 focus-within:border-border-strong">
          {attachments.length > 0 ? (
            <ul aria-label={copy.preview.attachment.group} className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <li
                  key={a.id}
                  className="inline-flex h-8 max-w-full items-center gap-2 rounded-control border border-border bg-surface-2 pr-1 pl-2 text-meta text-text"
                >
                  {a.thumbnail ? (
                    <img
                      src={a.thumbnail}
                      alt=""
                      className="size-5 shrink-0 rounded-badge object-cover"
                    />
                  ) : null}
                  <span className="max-w-56 truncate font-mono">{a.label}</span>
                  <IconButton
                    label={copy.preview.attachment.remove(a.label)}
                    onClick={() => onRemoveAttachment?.(a.id)}
                  >
                    <X size={14} strokeWidth={1.5} aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : null}
          <label id={labelId} htmlFor={`${labelId}-field`} className="sr-only">
            {copy.chat.composerLabel}
          </label>
          <textarea
            id={`${labelId}-field`}
            ref={field}
            rows={1}
            value={draft}
            placeholder={copy.chat.placeholder}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-48 w-full resize-none bg-transparent px-1 py-1 text-chat text-text outline-none placeholder:text-text-3"
          />
          <div className="flex items-center gap-2">
            <RadioMenu
              label={copy.chat.role.pick}
              value={role ?? AUTO}
              onValueChange={(value) => onRole(value === AUTO ? null : value)}
              options={[
                { value: AUTO, label: copy.chat.role.auto },
                ...roles.map((r) => ({ value: r.id, label: r.name })),
              ]}
              trigger={
                <Chip aria-label={`${copy.chat.role.label}: ${roleName}`} selected={role !== null}>
                  {roleName}
                  <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" className="ml-1" />
                </Chip>
              }
            />
            <RadioMenu
              label={copy.chat.model.pick}
              value={model ?? AUTO}
              onValueChange={(value) => onModel(value === AUTO ? null : value)}
              options={[
                { value: AUTO, label: copy.chat.model.auto },
                ...models.map((m) => ({ value: m.id, label: m.label, hint: m.kind })),
              ]}
              trigger={
                <Chip
                  aria-label={`${copy.chat.model.label}: ${modelName}`}
                  selected={model !== null}
                >
                  <span className="max-w-40 truncate">{modelName}</span>
                  <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" className="ml-1" />
                </Chip>
              }
            />
            <span className="ml-auto flex items-center gap-1">
              {canEditLast ? (
                <IconButton
                  label={copy.chat.editLast}
                  title={copy.chat.editLastHint}
                  onClick={onEditLast}
                >
                  <Pencil size={16} strokeWidth={1.5} aria-hidden="true" />
                </IconButton>
              ) : null}
              {streaming ? (
                <Button variant="secondary" onClick={onStop}>
                  <Square size={14} strokeWidth={1.5} aria-hidden="true" />
                  {copy.chat.stop}
                </Button>
              ) : (
                <Button variant="primary" disabled={!canSend} onClick={onSend}>
                  <ArrowUp size={14} strokeWidth={1.5} aria-hidden="true" />
                  {copy.chat.send}
                </Button>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
