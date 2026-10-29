import { useMemo } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { CommentCard, CommentEditor } from './CommentBox';
import { highlightLine, languageOf } from './highlight';
import { parsePatch, toSplitRows, type DiffLineData, type Hunk } from './parsePatch';

export type DiffView = 'unified' | 'split';

export interface DiffTableProps {
  path: string;
  patch: string;
  view: DiffView;
  /** Komentar yang belum dikirim pada file ini: nomor baris baru ke isi. */
  comments: ReadonlyMap<number, string>;
  /** Baris yang sedang dikomentari (penyunting terbuka). */
  editing: number | null;
  onStartComment: (line: number) => void;
  onSaveComment: (line: number, body: string) => void;
  onCancelComment: () => void;
  onRemoveComment: (line: number) => void;
  /** Hanya lihat (tab Git): nomor baris tidak bisa dikomentari. */
  readOnly?: boolean;
}

interface Shown extends DiffLineData {
  html: string;
}
interface ShownHunk {
  header: string;
  lines: Shown[];
}

const rowTone: Record<DiffLineData['kind'], string> = {
  add: 'border-l-success bg-success/10',
  del: 'border-l-danger bg-danger/10',
  ctx: 'border-l-transparent',
};
const sign: Record<DiffLineData['kind'], string> = { add: '+', del: '−', ctx: ' ' };

function Code({ html }: { html: string }) {
  // `html` berasal dari highlightLine: isi baris sudah di-escape.
  return (
    <span
      className="min-w-0 break-all whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Nomor baris baru; pada baris tambah menjadi tombol untuk memberi komentar. */
function NewNo({
  line,
  onStart,
  readOnly = false,
}: {
  line: Shown;
  onStart: (n: number) => void;
  readOnly?: boolean;
}) {
  if (line.newNo === null) return <span aria-hidden="true" />;
  if (line.kind !== 'add' || readOnly) return <span className="text-text-3">{line.newNo}</span>;
  const n = line.newNo;
  return (
    <button
      type="button"
      aria-label={copy.review.commentLine(n)}
      onClick={() => onStart(n)}
      className="rounded-badge text-right text-text-3 underline-offset-2 hover:bg-accent-soft hover:text-text hover:underline"
    >
      {n}
    </button>
  );
}

function Extras({ props, line }: { props: DiffTableProps; line: number | null }) {
  if (line === null) return null;
  if (props.editing === line) {
    return (
      <CommentEditor
        path={props.path}
        line={line}
        initial={props.comments.get(line) ?? ''}
        onSave={(body) => props.onSaveComment(line, body)}
        onCancel={props.onCancelComment}
      />
    );
  }
  const body = props.comments.get(line);
  if (body === undefined) return null;
  return (
    <CommentCard
      body={body}
      onEdit={() => props.onStartComment(line)}
      onRemove={() => props.onRemoveComment(line)}
    />
  );
}

function Unified({ hunk, props }: { hunk: ShownHunk; props: DiffTableProps }) {
  return (
    <>
      {hunk.lines.map((line, i) => (
        <div key={i}>
          <div
            className={cn(
              'grid grid-cols-[3rem_3rem_1.25rem_1fr] gap-x-1 border-l-2 px-1',
              rowTone[line.kind],
            )}
          >
            <span className="text-right text-text-3">{line.oldNo ?? ''}</span>
            <NewNo line={line} onStart={props.onStartComment} readOnly={props.readOnly === true} />
            <span aria-hidden="true" className="text-text-3">
              {sign[line.kind]}
            </span>
            <Code html={line.html} />
          </div>
          <Extras props={props} line={line.kind === 'add' ? line.newNo : null} />
        </div>
      ))}
    </>
  );
}

function Side({
  line,
  props,
  right,
}: {
  line: Shown | null;
  props: DiffTableProps;
  right: boolean;
}) {
  if (!line) return <div className="bg-surface-2/40" />;
  return (
    <div
      className={cn(
        'grid grid-cols-[3rem_1.25rem_1fr] gap-x-1 border-l-2 px-1',
        rowTone[line.kind],
      )}
    >
      {right ? (
        <NewNo line={line} onStart={props.onStartComment} readOnly={props.readOnly === true} />
      ) : (
        <span className="text-right text-text-3">{line.oldNo ?? ''}</span>
      )}
      <span aria-hidden="true" className="text-text-3">
        {sign[line.kind]}
      </span>
      <Code html={line.html} />
    </div>
  );
}

function Split({ hunk, props }: { hunk: ShownHunk; props: DiffTableProps }) {
  const rows = useMemo(() => toSplitRows(hunk), [hunk]) as {
    left: Shown | null;
    right: Shown | null;
  }[];
  return (
    <>
      {rows.map((row, i) => (
        <div key={i}>
          <div className="grid grid-cols-2 divide-x divide-border">
            <Side line={row.left} props={props} right={false} />
            <Side line={row.right} props={props} right />
          </div>
          <Extras props={props} line={row.right?.kind === 'add' ? row.right.newNo : null} />
        </div>
      ))}
    </>
  );
}

/** Isi diff satu file: unified atau split, warna sintaks per baris, dan komentar pada baris tambah. */
export function DiffTable(props: DiffTableProps) {
  const { path, patch, view } = props;
  const hunks = useMemo<ShownHunk[]>(() => {
    const language = languageOf(path);
    return parsePatch(patch).map((hunk: Hunk) => ({
      header: hunk.header,
      lines: hunk.lines.map((line) => ({ ...line, html: highlightLine(line.text, language) })),
    }));
  }, [patch, path]);

  return (
    <div className="font-mono text-ui leading-6 text-text">
      {hunks.map((hunk, i) => (
        <section key={i} aria-label={`${copy.review.hunkLabel} ${i + 1}`}>
          <div className="truncate bg-surface-2 px-3 py-0.5 text-meta text-text-3">
            {hunk.header}
          </div>
          {view === 'split' ? (
            <Split hunk={hunk} props={props} />
          ) : (
            <Unified hunk={hunk} props={props} />
          )}
        </section>
      ))}
    </div>
  );
}
