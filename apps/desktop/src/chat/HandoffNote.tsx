import { HANDOFF_PREFIX } from '@aios/contracts';
import { copy } from '../copy';
import { Markdown } from '../markdown/Markdown';

/** Pesan sistem pembawa ringkasan percakapan lanjutan; pesan sistem lain tidak ditampilkan. */
export const isHandoffNote = (text: string) => text.startsWith(HANDOFF_PREFIX);

/** Ringkasan dari percakapan sebelumnya, tampil di awal percakapan lanjutan (bisa dilipat). */
export function HandoffNote({ text }: { text: string }) {
  const body = text.slice(text.indexOf('\n\n') + 2);
  return (
    <details
      open
      className="animate-aios-enter rounded-panel border border-border bg-surface px-4 py-3"
    >
      <summary className="cursor-pointer text-meta text-text-2">
        {copy.chat.handoff.noteTitle}
      </summary>
      <div className="pt-2">
        <Markdown source={body} />
      </div>
    </details>
  );
}
