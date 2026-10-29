import type { ReactNode } from 'react';

export interface EmptyStateProps {
  message: string;
  /** Satu tombol aksi bila ada yang bisa dilakukan. */
  action?: ReactNode;
}

/** Satu kalimat tentang apa yang bisa dilakukan, plus satu aksi; tanpa ilustrasi. */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex animate-aios-enter flex-col items-start gap-4 px-6 py-8">
      <p className="max-w-[56ch] text-ui text-text-2">{message}</p>
      {action}
    </div>
  );
}
