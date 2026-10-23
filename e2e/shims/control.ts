/** Alamat server kendali E2E; diisi Playwright lewat addInitScript sebelum aplikasi dimuat. */
export function controlUrl(): string {
  const url = (window as unknown as { __E2E_CONTROL__?: string }).__E2E_CONTROL__;
  if (!url) throw new Error('E2E: __E2E_CONTROL__ belum diisi');
  return url;
}
