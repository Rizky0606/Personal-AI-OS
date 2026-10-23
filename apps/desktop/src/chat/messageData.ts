import type { Message } from '@aios/contracts';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { MessagePage } from '../api/gateway';

type MessagePages = InfiniteData<MessagePage, string | undefined>;

/** Halaman dari server terbaru dulu; untuk tampilan dibalik menjadi urutan waktu. */
export function chronological(data: { pages: MessagePage[] } | undefined): Message[] {
  if (!data) return [];
  return data.pages
    .flatMap((page) => page.items)
    .slice()
    .reverse();
}

/** Teks pesan: gabungan semua bagian `text`. */
export function messageText(message: Message): string {
  return message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
    .trim();
}

/**
 * Menaruh pesan yang baru dikonfirmasi server ke cache tanpa menunggu refetch, supaya pesan pengguna tidak
 * hilang sesaat antara "terkirim" dan "muncul dari server". Tidak ganda bila sudah ada.
 */
export function addMessageToCache(
  queryClient: QueryClient,
  conversationId: string,
  message: Message,
): void {
  queryClient.setQueryData<MessagePages>(['messages', conversationId], (old) => {
    if (!old) {
      return { pages: [{ items: [message], nextBefore: null }], pageParams: [undefined] };
    }
    if (old.pages.some((page) => page.items.some((m) => m.id === message.id))) return old;
    const [first, ...rest] = old.pages;
    if (!first) return old;
    return { ...old, pages: [{ ...first, items: [message, ...first.items] }, ...rest] };
  });
}

/** ID run dari pesan terbaru yang punya run; dipakai untuk melanjutkan jawaban yang belum selesai. */
export function latestRunId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const runId = messages[i]?.runId;
    if (runId) return runId;
  }
  return null;
}
