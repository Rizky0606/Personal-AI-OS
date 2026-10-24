import { FileText, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/TextArea';

export interface UserMessageProps {
  text: string;
  /** Lampiran pesan (nama dan MIME); ditampilkan sebagai chip di bawah teks. */
  files?: readonly { fileId: string; name: string; mime: string }[];
  /** Mengirim teks hasil ubahan; true bila berhasil (editor ditutup). Tanpa ini pesan tidak bisa diubah. */
  onEdit?: ((text: string) => Promise<boolean>) | undefined;
  /** Meminta konfirmasi hapus pesan ini beserta sesudahnya. */
  onDelete?: (() => void) | undefined;
  /** Hanya pesan terakhir: kirim ulang teks yang sama sebagai pesan baru. */
  onResend?: (() => void) | undefined;
}

/**
 * Blok `surface-2` rata kanan, radius 10 (DESIGN_SYSTEM: Pesan pengguna). Aksi muncul saat kursor atau fokus
 * berada di pesan; Ubah mengganti blok dengan editor di tempat.
 */
export function UserMessage({ text, files = [], onEdit, onDelete, onResend }: UserMessageProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!onEdit || saving || !value.trim()) return;
    setSaving(true);
    const ok = await onEdit(value);
    setSaving(false);
    if (ok) setEditing(false);
  }

  if (editing) {
    return (
      <article aria-label={copy.chat.you} className="flex flex-col items-end gap-2">
        <div className="w-full max-w-[72ch]">
          <TextArea
            label={copy.chat.editLabel}
            hint={copy.chat.editNote}
            value={value}
            rows={3}
            autoFocus
            disabled={saving}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false);
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
            {copy.chat.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={saving || !value.trim()}
            onClick={() => void submit()}
          >
            {copy.chat.editSubmit}
          </Button>
        </div>
      </article>
    );
  }

  const hasActions = Boolean(onEdit ?? onDelete ?? onResend);
  return (
    <article
      aria-label={copy.chat.you}
      className="group flex animate-aios-enter flex-col items-end gap-1"
    >
      {text ? (
        <p className="max-w-[72ch] rounded-panel bg-surface-2 px-3 py-2 text-chat whitespace-pre-wrap text-text">
          {text}
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul
          aria-label={copy.chat.files.group}
          className="flex max-w-[72ch] flex-wrap justify-end gap-2"
        >
          {files.map((file) => (
            <li
              key={file.fileId}
              className="inline-flex h-8 max-w-full items-center gap-2 rounded-control border border-border bg-surface-2 px-2 text-meta text-text"
            >
              {file.mime.startsWith('image/') ? (
                <ImageIcon size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
              ) : (
                <FileText size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
              )}
              <span className="max-w-56 truncate">{file.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {hasActions ? (
        <div className="flex gap-1 opacity-0 transition-opacity duration-[120ms] group-focus-within:opacity-100 group-hover:opacity-100">
          {onEdit ? (
            <Button
              variant="ghost"
              onClick={() => {
                setValue(text);
                setEditing(true);
              }}
            >
              {copy.chat.edit}
            </Button>
          ) : null}
          {onResend ? (
            <Button variant="ghost" onClick={onResend}>
              {copy.chat.resend}
            </Button>
          ) : null}
          {onDelete ? (
            <Button variant="ghost" onClick={onDelete}>
              {copy.chat.deleteMessage}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
