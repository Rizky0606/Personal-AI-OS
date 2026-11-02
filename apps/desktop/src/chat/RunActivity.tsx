import { ChevronDown, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copy } from '../copy';
import { api } from '../app/services';
import { cn } from '../lib/cn';
import { formatElapsed, type Activity } from '../realtime/activity';
import type { LiveArtifact } from '../realtime/liveRun';

/** Yang dibutuhkan pratinjau: berkas run yang sedang mengalir maupun yang dibaca dari agregat tersimpan. */
export type ArtifactRef = Pick<LiveArtifact, 'fileId' | 'name' | 'mime'>;
import { ArtifactLightbox, isPreviewableImage } from './ArtifactLightbox';
import { ToolStepRow } from './ToolStepRow';

export interface RunActivityProps {
  activity: Activity;
  now: number;
  onApproval?: () => void;
  output?: string | undefined;
  artifacts?: ArtifactRef[];
}

function ArtifactPreviews({ artifacts }: { artifacts: ArtifactRef[] }) {
  const [selected, setSelected] = useState<ArtifactRef | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void Promise.all(
      artifacts
        .slice(0, 4)
        .filter((file) => isPreviewableImage(file.mime))
        .map(async (file) => {
          try {
            const next = URL.createObjectURL(await api.downloadFile(file.fileId));
            urls.push(next);
            if (alive) setThumbs((current) => ({ ...current, [file.fileId]: next }));
          } catch {
            /* pratinjau penuh melaporkan galatnya */
          }
        }),
    );
    return () => {
      alive = false;
      urls.forEach((next) => URL.revokeObjectURL(next));
    };
  }, [artifacts]);
  return (
    <>
      <div className="flex gap-2">
        {artifacts.slice(0, 4).map((file) => (
          <button
            key={file.fileId}
            type="button"
            aria-label={`Preview: ${file.name}`}
            onClick={() => setSelected(file)}
            className="size-14 overflow-hidden rounded-control border border-border"
          >
            {thumbs[file.fileId] ? (
              <img src={thumbs[file.fileId]} alt="" className="size-full object-cover" />
            ) : (
              <span className="p-1 text-meta text-text-3">{file.name}</span>
            )}
            <span className="sr-only">{file.name}</span>
          </button>
        ))}
        {artifacts.length > 4 ? <span>{`+${artifacts.length - 4}`}</span> : null}
      </div>
      {selected ? <ArtifactLightbox file={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

const ui = copy.runActivity.ui;
const SETTLED: Activity['phase'][] = ['done', 'error', 'cancelled'];

/**
 * Baris aktivitas di dalam jawaban, urutan seperti Claude: (a) judul abu dengan kilau selagi berjalan (satu-satunya
 * bagian aria-live), (b) baris terlipat: aksi saat ini + target redup + timer + "+N" + chevron (setelah selesai
 * berisi ringkasan "Selesai · durasi · N langkah"), (c) saat dibuka: linimasa langkah, output terakhir, pratinjau
 * artifact, dan jalan pintas ke izin. Enter/Spasi membuka lewat tombol asli.
 */
export function RunActivity({ activity, onApproval, output, artifacts = [] }: RunActivityProps) {
  const [open, setOpen] = useState(activity.needsAttention);
  // Galat tool atau izin yang datang belakangan membuka linimasa; pengguna tetap bisa menutupnya.
  useEffect(() => {
    if (activity.needsAttention) setOpen(true);
  }, [activity.needsAttention]);
  const toggle = () => setOpen((value) => !value);
  const settled = SETTLED.includes(activity.phase);
  const others = Math.max(0, activity.stepCount - (activity.current ? 1 : 0));
  return (
    <section
      data-run-activity
      data-phase={activity.phase}
      className={`aios-run-activity aios-run-activity-${activity.phase} flex flex-col gap-1`}
    >
      {activity.headline ? (
        <p
          aria-live="polite"
          className={cn('text-ui text-text-3', !settled && 'aios-headline-shimmer')}
        >
          {activity.headline}
        </p>
      ) : null}
      <button
        type="button"
        aria-label={ui.toggle}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        }}
        className="flex min-h-9 w-full items-center gap-2 rounded-control text-left text-ui text-text-2 transition-colors duration-[120ms] ease-aios hover:text-text"
      >
        <span className="min-w-0 flex-1 truncate">
          {settled ? (
            (activity.summary ?? ui.phase[activity.phase])
          ) : activity.current && activity.phase !== 'waiting_approval' ? (
            <>
              {activity.current.label}
              {activity.current.target ? (
                <span className="ml-2 font-mono text-meta text-text-3">
                  {activity.current.target}
                </span>
              ) : null}
            </>
          ) : (
            <>
              {ui.phase[activity.phase]}
              {activity.phase === 'waiting_approval' && activity.current?.target ? (
                <span className="ml-2 font-mono text-meta text-text-3">
                  {activity.current.target}
                </span>
              ) : null}
            </>
          )}
        </span>
        {settled ? null : (
          <span className="shrink-0 font-mono text-meta text-text-3">
            {formatElapsed(activity.elapsedMs)}
          </span>
        )}
        {!settled && others > 0 ? (
          <span className="shrink-0 font-mono text-meta text-text-3">+{others}</span>
        ) : null}
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-text-3 transition-transform duration-[180ms] ease-aios',
            open && 'rotate-180',
          )}
        />
      </button>
      {artifacts.length > 0 && !open ? <ArtifactPreviews artifacts={artifacts} /> : null}
      {open ? (
        <div className="flex animate-aios-enter flex-col gap-2 border-l border-border pl-3">
          {artifacts.length > 0 ? <ArtifactPreviews artifacts={artifacts} /> : null}
          {activity.steps.length > 0 ? (
            <ol aria-label={ui.timeline} className="flex flex-col">
              {activity.steps.map((step) => (
                <ToolStepRow key={step.id} step={step} />
              ))}
            </ol>
          ) : null}
          {output ? (
            <p className="truncate font-mono text-meta text-text-2" aria-label={ui.toolOutput}>
              {output}
            </p>
          ) : null}
          {activity.phase === 'waiting_approval' ? (
            <button
              type="button"
              onClick={onApproval}
              className="inline-flex min-h-9 items-center gap-2 self-start text-ui text-warning underline"
            >
              {ui.openApproval} <ExternalLink size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
