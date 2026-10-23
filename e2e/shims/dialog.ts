/** Pemilih folder: tes mengisi `window.__E2E_PICK_FOLDER` sebelum mengklik tombol. */
export function open(): Promise<string | null> {
  const picked = (window as unknown as { __E2E_PICK_FOLDER?: string }).__E2E_PICK_FOLDER;
  return Promise.resolve(picked ?? null);
}
