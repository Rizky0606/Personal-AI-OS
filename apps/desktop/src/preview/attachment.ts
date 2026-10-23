import type { ContextAttachment } from '../state/uiStore';
import type { PickMessageData } from './bridge';

const MAX_HTML = 3000;

/** Path halaman tanpa host (host-nya proxy lokal acak, tidak berguna bagi agent). */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Konteks elemen terpilih sebagai blok teks untuk pesan: selector, HTML, style terhitung penting, dan ukuran.
 * Gambar tidak ikut terkirim (lampiran berkas belum ada); agent memotret sendiri lewat browser_screenshot.
 */
export function elementContext(pick: PickMessageData): string {
  const styles = Object.entries(pick.styles)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
  return [
    '[Elemen dipilih dari preview]',
    `Halaman: ${pathOf(pick.url)}`,
    `Selector: ${pick.selector}`,
    `Ukuran: ${pick.rect.width}x${pick.rect.height} px pada viewport ${pick.viewport.width}x${pick.viewport.height}`,
    pick.text ? `Teks: ${pick.text}` : '',
    'HTML:',
    '```html',
    pick.html.length > MAX_HTML ? `${pick.html.slice(0, MAX_HTML)}…` : pick.html,
    '```',
    'Style terhitung:',
    '```css',
    styles,
    '```',
    `Untuk melihat elemen ini, panggil browser_screenshot dengan selector "${pick.selector}" ` +
      `(width ${pick.viewport.width} bila ukuran layarnya penting).`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function toAttachment(pick: PickMessageData, thumbnail?: string): ContextAttachment {
  return {
    id: `${pick.selector}@${pick.url}`,
    label: pick.selector,
    text: elementContext(pick),
    ...(thumbnail ? { thumbnail } : {}),
  };
}

/** Teks akhir pesan: ketikan pengguna, lalu setiap lampiran konteks. */
export function withAttachments(text: string, attachments: readonly ContextAttachment[]): string {
  return attachments.length === 0 ? text : [text, ...attachments.map((a) => a.text)].join('\n\n');
}
