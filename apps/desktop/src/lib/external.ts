import { isTauri } from './tauri';

const ALLOWED = /^(https?:\/\/|mailto:)/i;

/** Membuka tautan di peramban sistem; hanya http, https, dan mailto. Di dalam webview aplikasi tidak pernah dinavigasi. */
export async function openExternal(url: string): Promise<void> {
  if (!ALLOWED.test(url)) return;
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Menyimpan blob sebagai berkas unduhan lewat tautan sementara. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
