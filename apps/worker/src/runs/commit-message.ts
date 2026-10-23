/** Ditambahkan ke prompt sistem run coding supaya agent menulis pesan commit-nya sendiri. */
export const COMMIT_INSTRUCTION =
  '\n\nSetelah selesai mengubah berkas, akhiri jawaban terakhir dengan satu baris berformat ' +
  '"Commit: <type>(<scope opsional>): <ringkasan singkat huruf kecil>" memakai Conventional Commits ' +
  '(feat, fix, refactor, test, docs, chore). Jangan menjalankan git commit sendiri.';

const CONVENTIONAL =
  /^(feat|fix|refactor|test|docs|chore|perf|build|ci|style)(\([\w./-]+\))?!?: \S.*$/;
const MAX_SUBJECT = 100;

export const isConventional = (message: string): boolean => CONVENTIONAL.test(message);

/** Baris `Commit: ...` terakhir pada teks jawaban agent, bila berformat Conventional Commits. */
export function parseCommitMessage(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^\s*(?:[-*>]\s*)?\**Commit:\**\s*`?(.+?)`?\s*$/i.exec(lines[i] ?? '');
    const candidate = match?.[1]?.trim();
    if (candidate && candidate.length <= MAX_SUBJECT && isConventional(candidate)) return candidate;
  }
  return undefined;
}

const isTest = (path: string) => /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[a-z]+$/i.test(path);
const isDoc = (path: string) => /\.(md|mdx|txt)$/i.test(path) || /(^|\/)docs?\//i.test(path);

/** Dipakai bila agent tidak menulis `Commit:` yang valid: tipe ditebak dari berkas yang berubah. */
export function fallbackCommitMessage(summary: string, paths: string[]): string {
  const type =
    paths.length > 0 && paths.every(isTest)
      ? 'test'
      : paths.length > 0 && paths.every(isDoc)
        ? 'docs'
        : 'chore';
  const firstLine =
    summary
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\s#>*-]+/, '').trim())
      .find((line) => line !== '' && !/^commit:/i.test(line)) ?? 'perubahan dari agent';
  const subject = firstLine.replace(/[.\s]+$/, '').slice(0, 72);
  return `${type}: ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;
}
