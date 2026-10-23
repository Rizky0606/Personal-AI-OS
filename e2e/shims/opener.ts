/** Mencatat tautan yang akan dibuka di peramban sistem, agar tes bisa memeriksanya. */
export function openUrl(url: string): Promise<void> {
  const w = window as unknown as { __E2E_OPENED?: string[] };
  (w.__E2E_OPENED ??= []).push(url);
  return Promise.resolve();
}
