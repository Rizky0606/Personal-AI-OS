import { WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { SkeletonList } from './Skeleton';

export type ViewState = 'loading' | 'empty' | 'error' | 'offline' | 'content';

export interface StateViewProps {
  state: ViewState;
  loadingLabel: string;
  emptyMessage: string;
  errorMessage?: string;
  offlineMessage: string;
  retryLabel: string;
  onRetry?: () => void;
  emptyAction?: ReactNode;
  children?: ReactNode;
}

/**
 * Keadaan yang wajib didesain di setiap layar: memuat (skeleton), kosong, error, offline, dan isi.
 */
export function StateView({
  state,
  loadingLabel,
  emptyMessage,
  errorMessage,
  offlineMessage,
  retryLabel,
  onRetry,
  emptyAction,
  children,
}: StateViewProps) {
  switch (state) {
    case 'loading':
      return <SkeletonList label={loadingLabel} />;
    case 'empty':
      return <EmptyState message={emptyMessage} action={emptyAction} />;
    case 'error':
      return (
        <div className="p-4">
          <ErrorBanner
            message={errorMessage ?? ''}
            action={
              onRetry ? (
                <Button variant="secondary" onClick={onRetry}>
                  {retryLabel}
                </Button>
              ) : undefined
            }
          />
        </div>
      );
    case 'offline':
      return (
        <div className="flex items-center gap-2 p-4 text-ui text-text-2">
          <WifiOff size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>{offlineMessage}</span>
        </div>
      );
    case 'content':
      return <>{children}</>;
  }
}
