export type ServerUrlResult =
  { ok: true; url: string } | { ok: false; reason: 'empty' | 'invalid' | 'insecure' };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Menormalkan alamat server yang diketik: tambah https:// bila tanpa skema, buang `/` penutup.
 * HTTP hanya untuk loopback (gateway lokal saat pengembangan); selain itu wajib HTTPS.
 */
export function parseServerUrl(input: string): ServerUrlResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: 'empty' };
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return { ok: false, reason: 'invalid' };
  if (url.search || url.hash || url.username || url.password)
    return { ok: false, reason: 'invalid' };
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname))
    return { ok: false, reason: 'insecure' };
  return { ok: true, url: url.toString().replace(/\/+$/, '') };
}
