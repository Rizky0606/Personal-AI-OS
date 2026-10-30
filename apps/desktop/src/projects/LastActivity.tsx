import { copy } from '../copy';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/time';
import { statusDotClass, type WorkspaceRun } from '../workspace/runs';

/** Ringkasan aktivitas terakhir project: judul run terbaru, status (titik token + teks), dan waktunya. */
export function LastActivity({ entry }: { entry: WorkspaceRun | undefined }) {
  if (!entry) return <span className="text-meta text-text-3">{copy.projects.noActivity}</span>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="line-clamp-1 text-ui text-text">{entry.title}</span>
      <span className="flex items-center gap-2 text-meta text-text-2">
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-full', statusDotClass(entry.run.status))}
        />
        <span>{copy.runStatus[entry.run.status]}</span>
        <span className="text-text-3">{relativeTime(entry.run.updatedAt)}</span>
      </span>
    </span>
  );
}
