import type { ReviewFile } from '@aios/contracts';
import { Undo2 } from 'lucide-react';
import { copy } from '../copy';
import { IconButton } from '../ui/IconButton';
import { DiffTable, type DiffView } from './DiffTable';

export interface FileDiffProps {
  file: ReviewFile;
  view: DiffView;
  comments: ReadonlyMap<number, string>;
  editing: number | null;
  onStartComment: (line: number) => void;
  onSaveComment: (line: number, body: string) => void;
  onCancelComment: () => void;
  onRemoveComment: (line: number) => void;
  onRevert: () => void;
  /** Mengembalikan file memakai worker: dinonaktifkan saat operasi lain berjalan. */
  busy: boolean;
}

/** Satu file: judul lengket (path, status, tambah/hapus), tombol batalkan, dan isi diff. */
export function FileDiff({ file, view, busy, onRevert, ...table }: FileDiffProps) {
  return (
    <article
      aria-label={file.path}
      id={`file-${file.path}`}
      // overflow-clip (bukan hidden) supaya kepala berkas tetap lengket terhadap area gulir.
      className="animate-aios-enter overflow-clip rounded-panel border border-border"
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-ui text-text">{file.path}</p>
          {file.oldPath ? (
            <p className="truncate font-mono text-caption text-text-3">
              {copy.review.renamedFrom(file.oldPath)}
            </p>
          ) : null}
        </div>
        <span className="rounded-full bg-surface px-2 py-0.5 text-caption text-text-2">
          {copy.review.status[file.status]}
        </span>
        <span className="font-mono text-meta tabular-nums text-success">+{file.additions}</span>
        <span className="font-mono text-meta tabular-nums text-danger">−{file.deletions}</span>
        <IconButton label={copy.review.revertFile} disabled={busy} onClick={onRevert}>
          <Undo2 size={14} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </header>
      {file.binary ? (
        <p className="p-4 text-meta text-text-2">{copy.review.binary}</p>
      ) : (
        <>
          <DiffTable path={file.path} patch={file.patch} view={view} {...table} />
          {file.truncated ? (
            <p className="border-t border-border p-4 text-meta text-text-2">
              {copy.review.truncated}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}
