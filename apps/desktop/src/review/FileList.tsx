import type { ReviewFile } from '@aios/contracts';
import { copy } from '../copy';
import { cn } from '../lib/cn';

export interface FileListProps {
  files: ReviewFile[];
  /** Jumlah komentar belum terkirim per path. */
  commentCounts: ReadonlyMap<string, number>;
  selected: string | null;
  onSelect: (path: string) => void;
}

/** Daftar file yang berubah; memilih satu menggulir diff-nya ke atas. */
export function FileList({ files, commentCounts, selected, onSelect }: FileListProps) {
  return (
    <nav aria-label={copy.review.filesLabel}>
      <ul className="flex flex-col">
        {files.map((file) => {
          const comments = commentCounts.get(file.path) ?? 0;
          return (
            <li key={file.path}>
              <button
                type="button"
                aria-current={selected === file.path ? 'true' : undefined}
                onClick={() => onSelect(file.path)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control px-2 py-1 text-left text-ui hover:bg-surface-2',
                  selected === file.path && 'bg-accent-soft',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-text">{file.path}</span>
                {comments > 0 ? (
                  <span className="rounded-badge bg-accent-soft px-1.5 text-caption text-text">
                    {comments}
                  </span>
                ) : null}
                <span className="font-mono text-meta tabular-nums text-success">
                  +{file.additions}
                </span>
                <span className="font-mono text-meta tabular-nums text-danger">
                  −{file.deletions}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
