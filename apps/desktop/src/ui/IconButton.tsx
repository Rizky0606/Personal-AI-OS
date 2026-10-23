import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Wajib: nama aksi untuk pembaca layar (tombol ikon tidak punya teks). */
  label: string;
  active?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  active = false,
  className,
  children,
  type = 'button',
  ref,
  ...props
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={props['aria-pressed']}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-control text-text-2',
        'transition-colors duration-[120ms] ease-aios hover:bg-surface-2 hover:text-text',
        active && 'bg-accent-soft text-text',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
