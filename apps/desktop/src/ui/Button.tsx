import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Satu tombol primer per area; sisanya secondary atau ghost. */
  variant?: ButtonVariant;
  ref?: Ref<HTMLButtonElement>;
}

const variants: Record<ButtonVariant, string> = {
  // Gradien satu warna aksen, terangkat 1px dan bercahaya saat hover (DESIGN_SYSTEM: Efek).
  primary:
    'aios-primary text-on-accent enabled:hover:-translate-y-px enabled:hover:shadow-glow active:opacity-90',
  secondary:
    'border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2 active:bg-surface-2',
  ghost: 'text-text-2 hover:bg-surface-2 hover:text-text active:bg-surface-2',
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
        'inline-flex h-8 items-center justify-center gap-2 rounded-control px-3.5 text-ui font-medium whitespace-nowrap',
        'transition duration-[120ms] ease-aios active:scale-[0.98] disabled:active:scale-100',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
