import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Satu tombol primer per area; sisanya secondary atau ghost. */
  variant?: ButtonVariant;
  ref?: Ref<HTMLButtonElement>;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:opacity-90 active:opacity-80',
  secondary:
    'border border-border-strong bg-surface text-text hover:bg-surface-2 active:bg-surface-2',
  ghost: 'text-text hover:bg-surface-2 active:bg-surface-2',
  danger: 'border border-danger bg-surface text-danger hover:bg-surface-2 active:bg-surface-2',
};

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-2 rounded-control px-3 text-ui font-medium',
        'transition-[background-color,opacity] duration-[120ms] ease-aios',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
