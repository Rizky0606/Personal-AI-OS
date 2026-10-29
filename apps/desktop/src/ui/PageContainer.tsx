import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PageContainerProps {
  children: ReactNode;
  className?: string | undefined;
}

/**
 * Satu-satunya pembungkus lebar isi untuk layar non-chat: tengah, lebar maksimum dari token
 * `--aios-page-measure`, jarak dalam dan antar bagian yang sama. Layar tidak boleh memakai max-w sendiri.
 */
export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div
      data-page-container
      className={cn(
        'mx-auto flex w-full max-w-(--aios-page-measure) flex-col gap-6 px-6 py-6',
        className,
      )}
    >
      {children}
    </div>
  );
}
