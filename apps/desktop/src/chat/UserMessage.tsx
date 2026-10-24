import { copy } from '../copy';
import { Button } from '../ui/Button';

export interface UserMessageProps {
  text: string;
  /** Hanya pesan terakhir: masukkan teksnya ke kolom pesan untuk diubah. */
  onEdit?: (() => void) | undefined;
  /** Hanya pesan terakhir: kirim ulang teks yang sama sebagai pesan baru. */
  onResend?: (() => void) | undefined;
}

/** Blok `surface-2` rata kanan, radius 10 (DESIGN_SYSTEM: Pesan pengguna). */
export function UserMessage({ text, onEdit, onResend }: UserMessageProps) {
  return (
    <article aria-label={copy.chat.you} className="flex flex-col items-end gap-1">
      <p className="max-w-[72ch] rounded-panel bg-surface-2 px-3 py-2 text-chat whitespace-pre-wrap text-text">
        {text}
      </p>
      {onEdit || onResend ? (
        <div className="flex gap-1">
          {onEdit ? (
            <Button variant="ghost" onClick={onEdit} title={copy.chat.editLastHint}>
              {copy.chat.edit}
            </Button>
          ) : null}
          {onResend ? (
            <Button variant="ghost" onClick={onResend}>
              {copy.chat.resend}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
