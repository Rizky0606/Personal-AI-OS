/**
 * Quick Ask (W20): jendela kecil yang dibuka hotkey global dari aplikasi mana pun. Jendela itu hanya UI; semua
 * panggilan API dan WebSocket tetap di jendela utama, yang memegang satu-satunya sesi. Dua sesi di dua jendela
 * akan saling merotasi refresh token, dan pemakaian ulang token lama mencabut perangkat (SECURITY_OPS.md).
 * Kedua jendela bertukar event Tauri berikut.
 */

export const QUICK_LABEL = 'quick';
export const MAIN_LABEL = 'main';
export const QUICK_SHORTCUT = 'CommandOrControl+Shift+Space';

export const QuickEvent = {
  /** quick -> main: pertanyaan baru. */
  ask: 'quick:ask',
  /** main -> quick: kemajuan jawaban (teks lengkap sejauh ini, bukan potongan). */
  update: 'quick:update',
  /** quick -> main: buka percakapan di jendela utama. */
  open: 'quick:open',
  /** main -> quick: jendela baru ditampilkan lewat hotkey (fokus ke kolom tanya). */
  shown: 'quick:shown',
} as const;

export interface QuickAsk {
  id: string;
  text: string;
}

export type QuickStatus = 'sending' | 'streaming' | 'done' | 'error';

export interface QuickUpdate {
  id: string;
  status: QuickStatus;
  conversationId: string | null;
  text: string;
  error?: string;
}

export interface QuickOpen {
  conversationId: string;
}
