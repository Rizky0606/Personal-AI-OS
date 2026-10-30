import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PageHeaderProps {
  /** Judul halaman (20px/600). */
  title: ReactNode;
  /** Satu baris penjelasan redup di bawah judul. */
  description?: string;
  /** Aksi primer (dan sekunder) di kanan; satu tombol primer per halaman. */
  actions?: ReactNode;
  /** Tautan kembali di atas judul (halaman detail). */
  back?: ReactNode;
  className?: string;
}

/** Header halaman Command Center: judul, deskripsi satu baris, aksi di kanan. */
export function PageHeader({ title, description, actions, back, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {back}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-page font-semibold text-text">{title}</h2>
          {description ? (
            <p className="mt-1 truncate text-ui text-text-2" title={description}>
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export interface PageProps {
  children: ReactNode;
  width?: 'md' | 'lg';
  className?: string;
}

/** Kolom konten yang lega di tengah: jarak 32 di tepi dan 24 antarbagian. */
export function Page({ children, className }: PageProps) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-(--aios-page-measure) flex-col gap-6 px-8 py-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Delay masuk bertahap untuk daftar utama: maksimal 4 elemen x 40 ms. */
export function enterDelay(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, 3) * 40}ms` };
}

/** Bagian bergaris (Pengaturan dan sejenisnya): judul bagian, deskripsi, isi di bawah garis. */
export function Section({
  title,
  description,
  id,
  actions,
  children,
}: {
  title: string;
  description?: string;
  id: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 id={id} className="text-section font-semibold text-text">
            {title}
          </h3>
          {description ? <p className="mt-1 text-ui text-text-2">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
