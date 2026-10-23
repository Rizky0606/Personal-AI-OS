import { copy } from '../copy';

/** Blok `surface-2` rata kanan, radius 10 (DESIGN_SYSTEM: Pesan pengguna). */
export function UserMessage({ text }: { text: string }) {
  return (
    <article aria-label={copy.chat.you} className="flex justify-end">
      <p className="max-w-[72ch] rounded-panel bg-surface-2 px-3 py-2 text-chat whitespace-pre-wrap text-text">
        {text}
      </p>
    </article>
  );
}
