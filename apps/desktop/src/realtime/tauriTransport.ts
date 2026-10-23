import type { WsOpen } from './client';

interface TauriWsMessage {
  type: string;
  data: unknown;
}

/**
 * Soket lewat plugin websocket Tauri (klien Rust): hanya cara ini yang bisa memasang header Authorization
 * saat handshake, yang dibutuhkan gateway. Di peramban biasa tidak ada transport dan koneksi gagal dengan jelas.
 */
export const tauriOpen: WsOpen = async (url, headers, handlers) => {
  const { default: TauriWebSocket } = await import('@tauri-apps/plugin-websocket');
  const socket = await TauriWebSocket.connect(url, { headers });
  socket.addListener((message: TauriWsMessage) => {
    if (message.type === 'Text' && typeof message.data === 'string') {
      handlers.onMessage(message.data);
    } else if (message.type === 'Close') {
      const code = (message.data as { code?: number } | null)?.code;
      handlers.onClose(typeof code === 'number' ? code : null);
    }
  });
  // connect() selesai setelah handshake berhasil.
  handlers.onOpen();
  return {
    send: (text) => void socket.send(text).catch(() => handlers.onClose(null)),
    close: () => void socket.disconnect().catch(() => undefined),
  };
};

export const browserOpen: WsOpen = () =>
  Promise.reject(new Error('WebSocket terautentikasi hanya tersedia di aplikasi Tauri.'));
