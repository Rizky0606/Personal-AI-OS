import { cn } from '../lib/cn';

export interface SkeletonProps {
  className?: string;
}

/** Placeholder berbentuk konten untuk keadaan memuat; bukan spinner. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('aios-shimmer h-3 rounded-full bg-surface-2', className)}
    />
  );
}

export function SkeletonList({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-5 p-5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <Skeleton className="w-full" />
          <Skeleton className="w-1/3" />
        </div>
      ))}
    </div>
  );
}
