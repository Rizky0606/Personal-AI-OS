import type { RoleInfo } from '../api/gateway';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { RadioMenu } from '../ui/RadioMenu';

export interface RoleChipProps {
  /** ID role yang menjawab; null saat router belum memutuskan. */
  role: string | null;
  roles: RoleInfo[];
  /** Hanya jawaban terakhir yang bisa dijalankan ulang dengan role lain (aturan server). */
  onChange?: (role: string) => void;
  /** Jawaban sedang ditulis: titik berwarna aksen dan berdenyut. */
  active?: boolean;
}

const chipClass =
  'inline-flex h-6 items-center gap-1 rounded-full bg-accent-soft px-2.5 text-meta text-text';

/** Teks kecil + titik netral. Bila bisa diganti, klik membuka pemilih role. */
export function RoleChip({ role, roles, onChange, active = false }: RoleChipProps) {
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
  if (!onChange || !role) return <span className={chipClass}>{body}</span>;
  return (
    <RadioMenu
      label={copy.chat.role.rerun}
      value={role}
      onValueChange={onChange}
      options={roles.map((r) => ({ value: r.id, label: r.name }))}
      trigger={
        <button
          type="button"
          aria-label={`${copy.chat.role.label}: ${name}. ${copy.chat.role.rerun}`}
          className={`${chipClass} transition-colors duration-[120ms] ease-aios hover:text-text`}
        >
          {body}
        </button>
      }
    />
  );
}
