import type { ModelInfo } from '../api/gateway';
import { ArrowUp, ChevronDown, Paperclip, Pencil, Square, X } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import type { PendingFile } from './useFileAttachments';
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
  /** Berkas lampiran (diunggah ke /files). Tanpa onAddFiles tombol lampiran tidak tampil. */
  files?: readonly PendingFile[];
  onAddFiles?: (files: File[]) => void;
  onRemoveFile?: (id: string) => void;
}

const MAX_HEIGHT_PX = 192;

/**
 * Composer langsung siap ketik. Satu tombol primer: Kirim, atau Hentikan saat menjawab. Role tidak dipilih
 * di sini: router yang memutuskan dari isi pesan dan konteks (chat umum atau project).
 */
export function Composer({
  draft,
  onDraft,
  onSend,
  onStop,
  streaming,
  sending,
  models,
  model,
  onModel,
  canEditLast,
  onEditLast,
  focusNonce,
  suggestions,
  attachments = [],
  onRemoveAttachment,
  files = [],
  onAddFiles,
  onRemoveFile,
}: ComposerProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
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
    if (!streaming && canSend) onSend();
  }

  const modelName = model
    ? (models.find((m) => m.id === model)?.label ?? model)
    : copy.chat.model.auto;
  const uploading = files.some((f) => f.status === 'uploading');
  const hasFiles = files.some((f) => f.status === 'ready');
  const canSend = (draft.trim().length > 0 || hasFiles) && !sending && !uploading;

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
          {files.length > 0 ? (
            <ul aria-label={copy.chat.files.group} className="flex flex-wrap gap-2">
              {files.map((f) => (
                <li
                  key={f.id}
                  className={cn(
                    'inline-flex h-8 max-w-full items-center gap-2 rounded-control border bg-surface-2 pr-1 pl-2 text-meta',
                    f.status === 'error' ? 'border-danger text-danger' : 'border-border text-text',
                  )}
                >
                  <Paperclip size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
                  <span className="max-w-56 truncate">{f.name}</span>
                  {f.status === 'uploading' ? (
                    <span role="status" className="text-text-2">
                      {copy.chat.files.uploading}
                    </span>
                  ) : null}
                  {f.status === 'error' ? <span className="truncate">{f.error}</span> : null}
                  <IconButton
                    label={copy.chat.files.remove(f.name)}
                    onClick={() => onRemoveFile?.(f.id)}
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
            onPaste={(event) => {
              // Tempel gambar (tangkapan layar) langsung menjadi lampiran.
              const pasted = [...event.clipboardData.files];
              if (pasted.length === 0 || !onAddFiles) return;
              event.preventDefault();
              onAddFiles(pasted);
            }}
            className="max-h-48 w-full resize-none bg-transparent px-1 py-1 text-chat text-text outline-none placeholder:text-text-3"
          />
          <div className="flex items-center gap-2">
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
              {onAddFiles ? (
                <>
                  <input
                    ref={picker}
                    type="file"
                    multiple
                    hidden
                    tabIndex={-1}
                    onChange={(event) => {
                      const picked = [...(event.target.files ?? [])];
                      event.target.value = '';
                      if (picked.length > 0) onAddFiles(picked);
                    }}
                  />
                  <IconButton
                    label={copy.chat.files.attach}
                    title={copy.chat.files.attachHint}
                    onClick={() => picker.current?.click()}
                  >
                    <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />
                  </IconButton>
                </>
              ) : null}
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
