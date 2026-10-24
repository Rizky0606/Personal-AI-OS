import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export interface TooltipProps {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

/** Tooltip untuk tombol ikon; Provider ada di root aplikasi. */
export function Tooltip({ label, side = 'right', children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-50 animate-aios-pop rounded-badge border border-border bg-surface-2 px-2 py-1 text-meta text-text shadow-float"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
