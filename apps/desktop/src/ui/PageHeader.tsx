import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  /** Satu aksi utama per layar. */
  primary?: ReactNode;
  /** Aksi sekunder: lebih redup dan ditempatkan sebelum aksi utama. */
  secondary?: ReactNode;
}

/** Kepala layar non-chat: satu judul, aksi sekunder lalu satu aksi utama di kanan. */
export function PageHeader({ title, primary, secondary }: PageHeaderProps) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <h2 className="min-w-0 truncate text-section font-semibold text-text">{title}</h2>
      <div className="flex shrink-0 items-center gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
