import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  selected?: boolean;
  children: ReactNode;
}

/** Pil seragam: terpilih `accent-soft` dengan garis aksen halus, tidak terpilih `surface-2`. */
export function Chip({
  selected = false,
  className,
  children,
  type = 'button',
  ...props
}: ChipProps) {
  return (
    <button
      type={type}
      // Chip yang dipakai sebagai radio memakai aria-checked dari pemanggil; aria-pressed tidak sah di role radio.
      aria-pressed={props.role === 'radio' ? undefined : selected}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-meta whitespace-nowrap transition-colors duration-[120ms] ease-aios',
        selected
          ? 'border-accent bg-accent-soft text-text'
          : 'border-transparent bg-surface-2 text-text-2 hover:border-border hover:text-text',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
