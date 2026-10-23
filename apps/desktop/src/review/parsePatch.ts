export type LineKind = 'add' | 'del' | 'ctx';

export interface DiffLineData {
  kind: LineKind;
  /** Nomor baris di versi lama; null untuk baris tambah. */
  oldNo: number | null;
  /** Nomor baris di versi baru; null untuk baris hapus. Hanya baris ber-nomor baru yang bisa dikomentari. */
  newNo: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  lines: DiffLineData[];
}

export interface SplitRow {
  left: DiffLineData | null;
  right: DiffLineData | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Memecah unified diff satu berkas menjadi hunk berisi baris ber-nomor. Header berkas (diff --git, ---, +++) dilewati. */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const match = HUNK.exec(line);
    if (match) {
      current = { header: line, lines: [] };
      hunks.push(current);
      oldNo = Number(match[1]);
      newNo = Number(match[2]);
      continue;
    }
    if (!current) continue;
    const mark = line.charAt(0);
    if (mark === '+') {
      current.lines.push({ kind: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) });
    } else if (mark === '-') {
      current.lines.push({ kind: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) });
    } else if (mark === ' ') {
      current.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
    // "\ No newline at end of file" dan baris kosong penutup diabaikan.
  }
  return hunks;
}

/** Tampilan berdampingan: rangkaian baris hapus dipasangkan dengan rangkaian baris tambah di sebelahnya. */
export function toSplitRows(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLineData[] = [];
  let adds: DiffLineData[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const line of hunk.lines) {
    if (line.kind === 'del') {
      if (adds.length > 0) flush();
      dels.push(line);
    } else if (line.kind === 'add') {
      adds.push(line);
    } else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}
