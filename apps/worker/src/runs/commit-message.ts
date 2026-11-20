/** Ditambahkan ke prompt sistem run coding supaya agent menulis pesan commit-nya sendiri. */
export const COMMIT_INSTRUCTION =
  '\n\nSetelah selesai mengubah berkas, akhiri jawaban terakhir dengan satu baris berformat ' +
  '"Commit: <type>(<scope opsional>): <ringkasan>" memakai Conventional Commits ' +
  '(feat, fix, refactor, test, docs, chore). Type dan scope huruf kecil; ringkasan satu baris berbahasa Indonesia ' +
  'berbentuk perintah (mis. "tambahkan", "perbaiki"), hanya huruf Latin, dan nama identifier, fungsi, atau berkas ' +
  'ditulis persis seperti di kode (huruf besar-kecil dipertahankan, mis. formatPrice, page-count.ts). ' +
  'Jangan menjalankan git commit sendiri.';

const CONVENTIONAL =
  /^(feat|fix|refactor|test|docs|chore|perf|build|ci|style)(\([\w./-]+\))?!?: \S.*$/;
const MAX_SUBJECT = 100;
/** Sama dengan batas `commitMessage` pada `ReviewRunRequestSchema` (packages/contracts). */
const MAX_COMBINED = 200;
/** Huruf dari skrip selain Latin (Kiril, CJK, Arab, ...); angka, tanda baca, dan simbol tetap boleh. */
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u;

export const isConventional = (message: string): boolean => CONVENTIONAL.test(message);
export const isLatinOnly = (text: string): boolean => !NON_LATIN_LETTER.test(text);

/**
 * Baris `Commit: ...` terakhir pada teks jawaban agent, bila berformat Conventional Commits dan hanya memakai huruf
 * Latin. Baris dengan huruf skrip lain (mis. `jumlah товара`) dilewati; tanpa kandidat sah, pemanggil memakai fallback.
 */
export function parseCommitMessage(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = /^\s*(?:[-*>]\s*)?\**Commit:\**\s*`?(.+?)`?\s*$/i.exec(lines[i] ?? '');
    const candidate = match?.[1]?.trim();
    if (
      candidate &&
      candidate.length <= MAX_SUBJECT &&
      isConventional(candidate) &&
      isLatinOnly(candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Pesan untuk satu tinjauan berisi beberapa run (run lanjutan di folder kerja yang sama): type/scope dari run
 * pertama, ringkasan semua run digabung `; ` sesuai urutan (duplikat dibuang). Ringkasan yang membuat pesan
 * melebihi batas kontrak tidak diikutkan, jadi hasilnya tetap satu baris utuh tanpa kata terpotong.
 */
export function combineCommitMessages(messages: string[]): string | undefined {
  const [first, ...rest] = messages;
  if (first === undefined) return undefined;
  const summaries = [first.slice(first.indexOf(': ') + 2)];
  let message = first;
  for (const next of rest) {
    const summary = next.slice(next.indexOf(': ') + 2);
    if (summaries.includes(summary) || message.length + 2 + summary.length > MAX_COMBINED) continue;
    summaries.push(summary);
    message = `${message}; ${summary}`;
  }
  return message;
}

const isTest = (path: string) => /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[a-z]+$/i.test(path);
const isDoc = (path: string) => /\.(md|mdx|txt)$/i.test(path) || /(^|\/)docs?\//i.test(path);

/**
 * Baris jawaban agent yang menjadi ringkasan pesan commit cadangan: baris pertama yang tidak kosong, bukan baris
 * `Commit:`, dan hanya berhuruf Latin (penanda markdown di awal dibuang). Undefined bila tidak ada.
 */
export function summaryLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s#>*-]+/, '').trim())
    .find((line) => line !== '' && !/^commit:/i.test(line) && isLatinOnly(line));
}

/** Dipakai bila agent tidak menulis `Commit:` yang valid: tipe ditebak dari berkas yang berubah. */
export function fallbackCommitMessage(summary: string, paths: string[]): string {
  const type =
    paths.length > 0 && paths.every(isTest)
      ? 'test'
      : paths.length > 0 && paths.every(isDoc)
        ? 'docs'
        : 'chore';
  // Baris berhuruf non-Latin dilewati; bila tidak ada baris lain, pesan umum.
  const firstLine = summaryLine(summary) ?? 'perubahan dari agent';
  const subject = firstLine.replace(/[.\s]+$/, '').slice(0, 72);
  // Hanya kata kapital biasa (awal kalimat) yang dikecilkan; identifier seperti `PageCount` atau `README` utuh.
  return /^[A-Z][a-z]*(?![\w.-])/.test(subject)
    ? `${type}: ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`
    : `${type}: ${subject}`;
}
