const PARAM = /\{\{\s*([a-zA-Z0-9_-]{1,40})\s*\}\}/g;

/** Nama parameter `{{nama}}` di isi templat, berurutan sesuai kemunculan pertama dan tanpa duplikat. */
export function templateParams(body: string): string[] {
  return [...new Set([...body.matchAll(PARAM)].map((m) => m[1]!))];
}

/** Mengisi semua `{{nama}}`; parameter tanpa nilai menjadi kosong. */
export function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(PARAM, (_match, name: string) => values[name] ?? '');
}

/** Templat yang cocok dengan awalan `/nama` di draf; kosong bila draf bukan perintah garis miring. */
export function slashMatches<T extends { name: string }>(
  draft: string,
  templates: readonly T[],
): T[] {
  const match = /^\/([a-z0-9-]*)$/.exec(draft);
  if (!match) return [];
  const query = match[1]!;
  return templates
    .filter((t) => t.name.startsWith(query))
    .concat(templates.filter((t) => !t.name.startsWith(query) && t.name.includes(query)))
    .slice(0, 6);
}
