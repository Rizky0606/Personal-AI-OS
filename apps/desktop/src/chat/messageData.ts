import type { Message } from '@aios/contracts';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { MessagePage } from '../api/gateway';

type MessagePages = InfiniteData<MessagePage, string | undefined>;

/**
 * Halaman pertama berisi pesan terbaru, halaman berikutnya (`before`) lebih lama; isi tiap halaman sudah
 * kronologis (lama ke baru). Jadi urutan halaman dibalik, isi halaman dibiarkan.
 */
export function chronological(data: { pages: MessagePage[] } | undefined): Message[] {
  if (!data) return [];
  return data.pages
    .slice()
    .reverse()
    .flatMap((page) => page.items);
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
    // Halaman pertama = terbaru, isinya kronologis: pesan baru masuk di ujungnya.
    return { ...old, pages: [{ ...first, items: [...first.items, message] }, ...rest] };
  });
}

/**
 * Membuang pesan `fromId` dan semua sesudahnya dari cache (ID UUIDv7 urut waktu), sama seperti server.
 * Mengembalikan ID run dari pesan yang dibuang.
 */
export function truncateCache(
  queryClient: QueryClient,
  conversationId: string,
  fromId: string,
): string[] {
  const dropped = new Set<string>();
  queryClient.setQueryData<MessagePages>(['messages', conversationId], (old) => {
    if (!old) return old;
    const pages = old.pages.map((page) => ({
      ...page,
      items: page.items.filter((m) => {
        if (m.id < fromId) return true;
        if (m.runId) dropped.add(m.runId);
        return false;
      }),
    }));
    return { ...old, pages };
  });
  return [...dropped];
}

/** ID run dari pesan terbaru yang punya run; dipakai untuk melanjutkan jawaban yang belum selesai. */
export function latestRunId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const runId = messages[i]?.runId;
    if (runId) return runId;
  }
  return null;
}
