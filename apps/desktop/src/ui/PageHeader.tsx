import type { ReactNode } from 'react';
import { useScreenTitle } from './screenTitle';

export interface PageHeaderProps {
  title: string;
  /** Satu aksi utama per layar. */
  primary?: ReactNode;
  /** Aksi sekunder: lebih redup dan ditempatkan sebelum aksi utama. */
  secondary?: ReactNode;
}

/**
 * Kepala layar non-chat: satu judul, aksi sekunder lalu satu aksi utama di kanan. Di dalam Shell judulnya
 * ditampilkan Topbar (lihat `screenTitle.tsx`), jadi di sini hanya tersisa baris aksi, atau tidak ada sama sekali.
 */
export function PageHeader({ title, primary, secondary }: PageHeaderProps) {
  const delegated = useScreenTitle(title);
  if (delegated && !primary && !secondary) return null;
  return (
    <div
      data-page-header
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4"
    >
      {delegated ? (
        <span />
      ) : (
        <h2 className="min-w-0 truncate text-section font-semibold text-text">{title}</h2>
      )}
      <div className="flex shrink-0 items-center gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
