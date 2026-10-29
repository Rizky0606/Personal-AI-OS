import { cn } from '../lib/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Wajib: apa yang diaktifkan, untuk pembaca layar. */
  label: string;
  disabled?: boolean;
}

/** Sakelar hidup/mati. Status disampaikan lewat posisi, warna, dan aria-checked, bukan warna saja. */
export function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center justify-start rounded-full border p-0.5 transition duration-[180ms] ease-aios',
        checked ? 'border-accent bg-accent shadow-glow' : 'border-border-strong bg-surface-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-3.5 rounded-full transition duration-[180ms] ease-spring',
          checked ? 'translate-x-4 bg-on-accent' : 'translate-x-0 bg-text-3',
        )}
      />
    </button>
  );
}
