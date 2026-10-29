import { copy } from '../copy';
import { ISLAND } from './island';

function Bar({ className }: { className: string }) {
  return <div aria-hidden="true" className={`rounded-badge bg-surface-2 ${className}`} />;
}

/** Satu pulau kerangka: permukaan dengan sapuan aksen pelan (.aios-island-shimmer). */
function Island({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={`${ISLAND} relative overflow-hidden ${className}`}>
      <span
        aria-hidden="true"
        className="aios-island-shimmer pointer-events-none absolute inset-0"
      />
      {children}
    </div>
  );
}

/**
 * Keadaan memuat awal (sesi dipulihkan): kerangka sidebar, area utama, dan kaki dengan tata letak yang sama
 * seperti shell, bukan layar kosong, jadi tidak ada lompatan saat shell asli muncul.
 */
export function ShellSkeleton() {
  return (
    <div
      role="status"
      aria-label={copy.shell.loading}
      className="flex h-full flex-col bg-bg text-text"
    >
      <div className="flex min-h-0 flex-1 gap-(--aios-island-gap) p-(--aios-island-gap)">
        <Island className="flex w-(--aios-sidebar-width) shrink-0 flex-col gap-3 p-4">
          <Bar className="size-9" />
          <div className="mt-2 flex flex-col gap-2">
            {Array.from({ length: 7 }, (_, i) => (
              <Bar key={i} className="h-9 w-full" />
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Bar className="h-4 w-2/3" />
            <Bar className="h-4 w-1/2" />
            <Bar className="h-4 w-3/4" />
          </div>
        </Island>
        <Island className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-(--aios-topbar-height) items-center justify-between border-b border-border px-4">
            <Bar className="h-5 w-28" />
            <Bar className="h-7 w-32" />
          </div>
          <div className="flex flex-col gap-4 p-6">
            <Bar className="h-4 w-1/3" />
            <Bar className="h-4 w-2/3" />
            <Bar className="h-4 w-1/2" />
          </div>
        </Island>
      </div>
      <div className="h-(--aios-statusbar-height) shrink-0" />
    </div>
  );
}
