import type { OrbState } from './AgentOrb';
import type { ModelInfo } from '../api/gateway';
import { ArrowUp, ChevronDown, Paperclip, Pencil, Square, X } from 'lucide-react';
import type { PromptTemplate } from '@aios/contracts';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import type { PendingFile } from './useFileAttachments';
import type { ContextAttachment } from '../state/uiStore';
import { Button } from '../ui/Button';
import { Chip, type ChipProps } from '../ui/Chip';
import { IconButton } from '../ui/IconButton';
import { CheckboxMenu, type CheckboxOption } from '../ui/CheckboxMenu';
import { RadioMenu } from '../ui/RadioMenu';
import { slashMatches } from '../templates/vars';

export const AUTO = '__auto__';

export interface ComposerProps {
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** Run coding berjalan: Enter mengarahkan agent sekarang, Alt+Enter mengantre. Tanpa onSteer tombol dan pintasannya tidak tampil. */
  onSteer?: ((mode: 'steer' | 'followUp') => void) | undefined;
  /** Jawaban sedang mengalir: tombol kirim berubah menjadi hentikan. */
  streaming: boolean;
  /** Fase run untuk warna bingkai (sama dengan Orb). */
  phase?: OrbState;
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
  /** Templat prompt untuk menu `/` di awal pesan. Tanpa onUseTemplate menu tidak tampil. */
  templates?: readonly PromptTemplate[];
  onUseTemplate?: (template: PromptTemplate) => void;
  /** Mode rencana (hanya di dalam project): tanpa onPlanMode sakelarnya tidak tampil. */
  planMode?: boolean;
  onPlanMode?: (on: boolean) => void;
  /** Cari di web untuk pesan berikutnya; tanpa onWebSearch sakelarnya tidak tampil. */
  webSearch?: boolean;
  onWebSearch?: (on: boolean) => void;
  /** Paket skill tambahan untuk pesan berikutnya; tanpa onSkillPacks menunya tidak tampil. */
  skillPacks?: readonly string[];
  onSkillPacks?: (ids: string[]) => void;
  skillOptions?: CheckboxOption[];
}

const MAX_HEIGHT_PX = 192;

/** Pil seragam untuk mode, model, dan skill: bulat penuh, garis aksen saat aktif. */
function Pill({ selected = false, className, children, type = 'button', ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={props.role === 'radio' ? undefined : selected}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-meta transition-colors duration-[120ms] ease-aios',
        selected
          ? 'border-accent bg-accent-soft text-text'
          : 'border-border bg-surface-2 text-text-2 hover:border-border-strong hover:text-text',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Composer langsung siap ketik. Satu tombol primer: Kirim, atau Hentikan saat menjawab. Role tidak dipilih
 * di sini: router yang memutuskan dari isi pesan dan konteks (chat umum atau project).
 */
export function Composer({
  draft,
  onDraft,
  onSend,
  onStop,
  onSteer,
  streaming,
  phase,
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
  templates = [],
  onUseTemplate,
  planMode = false,
  onPlanMode,
  webSearch = false,
  onWebSearch,
  skillPacks = [],
  onSkillPacks,
  skillOptions = [],
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

  const [active, setActive] = useState(0);
  // Draf yang menunya sudah ditutup (Esc atau templat dipilih); menu muncul lagi saat draf berubah.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const matches = onUseTemplate && dismissed !== draft ? slashMatches(draft, templates) : [];
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  function pick(template: PromptTemplate) {
    setDismissed(draft);
    setActive(0);
    onUseTemplate?.(template);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length > 0 && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(
          (current + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length,
        );
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        pick(matches[current]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(draft);
        return;
      }
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (streaming) {
      if (onSteer && draft.trim().length > 0) onSteer(event.altKey ? 'followUp' : 'steer');
      return;
    }
    if (canSend) onSend();
  }

  const modelName = model
    ? (models.find((m) => m.id === model)?.label ?? model)
    : copy.chat.model.auto;
  const uploading = files.some((f) => f.status === 'uploading');
  const hasFiles = files.some((f) => f.status === 'ready');
  const canSend = (draft.trim().length > 0 || hasFiles) && !sending && !uploading;

  return (
    <div className="shrink-0 bg-bg px-8 pt-3 pb-4">
      <div className="mx-auto flex max-w-[calc(var(--aios-chat-measure)+2.5rem)] flex-col gap-2">
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
        <div
          data-phase={phase}
          className="aios-composer-frame flex flex-col gap-2 rounded-panel border border-border bg-surface p-2 transition duration-[180ms] ease-aios focus-within:border-border-strong focus-within:shadow-glow has-[[data-composer-field]:focus-visible]:border-accent"
        >
          {streaming ? (
            <span aria-hidden="true" className="aios-progress absolute inset-x-0 top-0 h-0.5" />
          ) : null}
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
          {matches.length > 0 ? (
            <ul
              role="listbox"
              aria-label={copy.templates.menuLabel}
              className="flex flex-col overflow-hidden rounded-control border border-border bg-surface-2"
            >
              {matches.map((template, i) => (
                <li
                  key={template.id}
                  role="option"
                  aria-selected={i === current}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(template)}
                  className={cn(
                    'flex cursor-pointer items-baseline gap-3 px-3 py-1 text-ui transition-colors duration-[120ms] ease-aios',
                    i === current ? 'bg-accent-soft' : 'hover:bg-surface',
                  )}
                >
                  <span className="shrink-0 font-mono text-text">/{template.name}</span>
                  <span className="truncate text-meta text-text-2">{template.body}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <label id={labelId} htmlFor={`${labelId}-field`} className="sr-only">
            {copy.chat.composerLabel}
          </label>
          <textarea
            id={`${labelId}-field`}
            data-composer-field=""
            ref={field}
            rows={1}
            value={draft}
            placeholder={streaming && onSteer ? copy.chat.steer.placeholder : copy.chat.placeholder}
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
          <div className="flex flex-wrap items-center gap-2">
            <RadioMenu
              label={copy.chat.model.pick}
              value={model ?? AUTO}
              onValueChange={(value) => onModel(value === AUTO ? null : value)}
              options={[
                { value: AUTO, label: copy.chat.model.auto },
                ...models.map((m) => ({ value: m.id, label: m.label, hint: m.kind })),
              ]}
              trigger={
                <Pill
                  aria-label={`${copy.chat.model.label}: ${modelName}`}
                  selected={model !== null}
                >
                  <span className="max-w-40 truncate">{modelName}</span>
                  <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
                </Pill>
              }
            />
            {onPlanMode ? (
              <Pill
                selected={planMode}
                title={copy.chat.plan.chipHint}
                onClick={() => onPlanMode(!planMode)}
              >
                {copy.chat.plan.chip}
              </Pill>
            ) : null}
            {onWebSearch ? (
              <Pill
                selected={webSearch}
                title={copy.chat.web.chipHint}
                onClick={() => onWebSearch(!webSearch)}
              >
                {copy.chat.web.chip}
              </Pill>
            ) : null}
            {onSkillPacks ? (
              <CheckboxMenu
                label={copy.chat.skills.label}
                values={skillPacks}
                onValuesChange={onSkillPacks}
                options={skillOptions}
                trigger={
                  <Pill selected={skillPacks.length > 0} title={copy.chat.skills.hint}>
                    {skillPacks.length > 0
                      ? copy.chat.skills.chipActive(skillPacks.length)
                      : copy.chat.skills.chip}
                    <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
                  </Pill>
                }
              />
            ) : null}
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
                <div className={cn('flex animate-aios-pop items-center gap-1', onSteer && 'rounded-control bg-surface-2 p-0.5')}>
                  <Button variant={streaming ? 'secondary' : 'primary'} onClick={streaming ? onStop : onSend} disabled={!streaming && !canSend} className="animate-aios-pop">
                    {streaming ? <Square size={14} strokeWidth={1.5} aria-hidden="true" /> : <ArrowUp size={14} strokeWidth={1.5} aria-hidden="true" />}
                    {streaming ? copy.chat.stop : copy.chat.send}
                  </Button>
                  {streaming && onSteer ? (
                    <>
                      <Button variant="secondary" disabled={draft.trim().length === 0} title={copy.chat.steer.queueHint} onClick={() => onSteer('followUp')}>{copy.chat.steer.queue}</Button>
                      <Button variant="primary" disabled={draft.trim().length === 0} title={copy.chat.steer.nowHint} onClick={() => onSteer('steer')}><ArrowUp size={14} strokeWidth={1.5} aria-hidden="true" />{copy.chat.steer.now}</Button>
                    </>
                  ) : null}
                </div>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
