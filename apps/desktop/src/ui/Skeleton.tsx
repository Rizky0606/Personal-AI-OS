import { cn } from '../lib/cn';

export interface SkeletonProps {
  className?: string;
}

/** Placeholder berbentuk konten untuk keadaan memuat; bukan spinner. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('h-3 rounded-badge bg-surface-2', className)}
      style={{ animation: 'aios-pulse 1.2s ease-in-out infinite' }}
    />
  );
}

export function SkeletonList({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-4 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="w-full" />
          <Skeleton className="w-1/3" />
        </div>
      ))}
    </div>
  );
}
