import { AppError } from '../../errors.js';
import { assertFetchableUrl, type UrlPolicy } from '../research/ssrf.js';

/**
 * Aturan URL konektor (docs/DESIGN_MCP_KONEKTOR.md bagian 8). Sengaja sama ketatnya dengan `isAllowedUrl`
 * pemasangan skill (`modules/skills/installer.ts:41-54`): https, tanpa userinfo, port 443, ditambah penolakan
 * alamat privat lewat `assertFetchableUrl`. Allowlist host bawaan kosong: yang diizinkan persis origin konektor
 * yang didaftarkan pemilik, dan setiap redirect harus tetap di origin itu.
 */
export type ConnectorUrlOptions = UrlPolicy;

const invalid = (detail: string) => new AppError(422, 'connector_url_invalid', detail);

/** URL konektor yang sah, sudah dinormalkan. Melempar `AppError` 422 dengan alasan yang bisa dibaca pemilik. */
export function parseConnectorUrl(raw: string, options: ConnectorUrlOptions = {}): URL {
  const text = raw.trim();
  if (text === '') throw invalid('URL konektor kosong.');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid('URL konektor tidak bisa dibaca. Contoh: https://contoh.com/mcp');
  }
  if (
    url.protocol !== 'https:' &&
    !(options.allowPrivateHosts === true && url.protocol === 'http:')
  )
    throw invalid('URL konektor harus https.');
  if (url.username !== '' || url.password !== '')
    throw invalid('URL konektor tidak boleh memuat nama pengguna atau sandi.');
  if (url.port !== '' && url.port !== '443' && options.allowPrivateHosts !== true)
    throw invalid('URL konektor harus memakai port 443.');
  if (url.hash !== '') throw invalid('URL konektor tidak boleh memuat fragmen (#).');
  try {
    assertFetchableUrl(url.toString(), options);
  } catch {
    throw invalid('Alamat konektor tidak boleh menunjuk ke jaringan privat.');
  }
  return url;
}

/** Origin (skema + host + port) yang mengunci semua permintaan, termasuk setiap hop redirect. */
export const originOf = (url: URL): string => `${url.protocol}//${url.host}`;

/**
 * Tujuan redirect yang masih boleh diikuti: lolos aturan yang sama DAN tetap di origin awal. Konektor A tidak
 * pernah bisa dibelokkan ke host konektor B atau ke host mana pun yang tidak didaftarkan pemilik.
 */
export function assertSameOriginRedirect(
  target: URL,
  origin: string,
  options: ConnectorUrlOptions = {},
): void {
  parseConnectorUrl(target.toString(), options);
  if (originOf(target) !== origin)
    throw invalid(`Konektor mengalihkan ke host lain (${target.host}); dihentikan.`);
}
