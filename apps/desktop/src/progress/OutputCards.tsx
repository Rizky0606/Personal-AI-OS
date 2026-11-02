import type { ProgressOutput } from '@aios/contracts';
import { FileSearch, FileText, GitCompare, Image as ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';

/** Kunci stabil sebuah output (berkas: fileId; diff dan riset: per run). */
export const outputKey = (o: ProgressOutput): string =>
  o.kind === 'image' || o.kind === 'file'
    ? o.fileId
    : o.kind === 'diff'
      ? `diff-${o.runId}`
      : `riset-${o.researchId}`;

export const outputTitle = (o: ProgressOutput): string =>
  o.kind === 'image' || o.kind === 'file'
    ? o.name
    : o.kind === 'diff'
      ? copy.progress.diffTitle(o.files.length)
      : o.title;

const KIND_ICON = { image: ImageIcon, file: FileText, diff: GitCompare, research: FileSearch };

/** Pratinjau gambar kecil dari byte yang diambil lewat endpoint terautentikasi; gagal = ikon jenis. */
function Thumb({ fileId, className }: { fileId: string; className: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    api
      .downloadFile(fileId)
      .then((blob) => {
        created = URL.createObjectURL(blob);
        if (alive) setUrl(created);
        else URL.revokeObjectURL(created);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [fileId]);
  return url ? <img src={url} alt="" className={className} /> : null;
}

function Card({
  output,
  isNew,
  onOpen,
}: {
  output: ProgressOutput;
  isNew: boolean;
  onOpen: (output: ProgressOutput) => void;
}) {
  const title = outputTitle(output);
  const kind = copy.progress.kinds[output.kind];
  const Icon = KIND_ICON[output.kind];
  return (
    <li className={cn('min-w-0', isNew && 'aios-card-in')}>
      <button
        type="button"
        aria-label={copy.progress.openOutput(title, kind)}
        onClick={() => onOpen(output)}
        className="flex w-full flex-col overflow-hidden rounded-control border border-border bg-surface-2 text-left transition-colors duration-[120ms] ease-aios hover:border-border-strong"
      >
        <span className="relative flex h-16 w-full items-center justify-center bg-surface-3 text-text-3">
          <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
          {output.kind === 'image' ? (
            <Thumb fileId={output.fileId} className="absolute inset-0 size-full object-cover" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
          <span className="truncate text-ui text-text">{title}</span>
          <span className="text-caption text-text-3">{kind}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Kartu Output dua kolom: pratinjau (gambar) atau ikon jenis, judul terpotong, dan jenis (Gambar, Berkas, Perubahan
 * kode, Laporan riset). Kartu yang tiba setelah panel terbuka masuk dengan naik 8 px + fade 240 ms.
 */
export function OutputCards({
  outputs,
  onOpen,
}: {
  outputs: ProgressOutput[];
  onOpen: (output: ProgressOutput) => void;
}) {
  // Kartu yang sudah ada saat panel pertama dirender tidak dianimasikan; hanya yang datang kemudian.
  const initial = useRef<Set<string> | null>(null);
  initial.current ??= new Set(outputs.map(outputKey));
  return (
    <ul aria-label={copy.progress.sections.outputs} className="grid grid-cols-2 gap-2">
      {outputs.map((output) => (
        <Card
          key={outputKey(output)}
          output={output}
          isNew={!initial.current!.has(outputKey(output))}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
