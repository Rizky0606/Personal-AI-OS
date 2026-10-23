import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  selected?: boolean;
  children: ReactNode;
}

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
        'inline-flex h-6 items-center rounded-badge px-2 text-meta transition-colors duration-[120ms] ease-aios',
        selected ? 'bg-accent-soft text-text' : 'bg-surface-2 text-text-2 hover:text-text',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
