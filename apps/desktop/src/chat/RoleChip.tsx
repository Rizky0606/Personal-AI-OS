import type { RoleInfo } from '../api/gateway';
import { copy } from '../copy';
import { cn } from '../lib/cn';

export interface RoleChipProps {
  /** ID role yang menjawab; null saat router belum memutuskan. */
  role: string | null;
  roles: RoleInfo[];
  /** Jawaban sedang ditulis: titik berwarna aksen dan berdenyut. */
  active?: boolean;
}

const chipClass =
  'inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-meta text-text';

/** Teks kecil + titik netral: agent yang menjawab (dipilih server dari ada tidaknya project). */
export function RoleChip({ role, roles, active = false }: RoleChipProps) {
  const name = role ? (roles.find((r) => r.id === role)?.name ?? role) : copy.runStatus.routing;
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full transition-colors duration-[180ms] ease-aios',
          active ? 'animate-aios-breathe bg-accent' : 'bg-text-3',
        )}
      />
      {name}
    </>
  );
  return <span className={chipClass}>{body}</span>;
}
