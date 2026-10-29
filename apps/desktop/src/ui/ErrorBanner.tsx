import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ErrorBannerProps {
  /** Apa yang gagal dan langkah berikutnya, tanpa menyalahkan pengguna. */
  message: string;
  action?: ReactNode;
  className?: string;
  tone?: 'danger' | 'warning';
}

export function ErrorBanner({ message, action, className, tone = 'danger' }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex animate-aios-enter items-start gap-3 rounded-panel border bg-surface p-3.5',
        tone === 'danger' ? 'border-danger' : 'border-warning',
        className,
      )}
    >
      <AlertTriangle
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
        className={cn('mt-0.5 shrink-0', tone === 'danger' ? 'text-danger' : 'text-warning')}
      />
      <p className="min-w-0 flex-1 text-ui text-text">{message}</p>
      {action}
    </div>
  );
}
