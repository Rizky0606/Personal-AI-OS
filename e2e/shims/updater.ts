/** Di E2E tidak ada rilis untuk diperiksa: selalu "sudah terbaru". */
export function check(): Promise<null> {
  return Promise.resolve(null);
}
