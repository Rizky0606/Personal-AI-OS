import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { create } from 'zustand';
import { copy } from '../copy';
import { cn } from '../lib/cn';

export interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'danger';
}

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, tone?: ToastItem['tone']) => void;
  dismiss: (id: number) => void;
}

const MAX_TOASTS = 3;
const TOAST_MS = 4_000;
let nextId = 1;

/** Antrean toast: paling banyak 3 bertumpuk; yang tertua dibuang lebih dulu. */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'info') =>
    set((s) => ({ toasts: [...s.toasts, { id: nextId++, message, tone }].slice(-MAX_TOASTS) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Pojok kanan bawah, 4 detik. Elemen melayang: satu-satunya selain menu dan dialog yang berbayang. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <ToastPrimitive.Provider duration={TOAST_MS} swipeDirection="right">
      {toasts.map((toast) => (
        <ToastPrimitive.Root
          key={toast.id}
          onOpenChange={(open) => {
            if (!open) dismiss(toast.id);
          }}
          className={cn(
            'flex animate-aios-toast items-start gap-3 rounded-panel border bg-surface p-3.5 shadow-float',
            toast.tone === 'danger' ? 'border-danger' : 'border-border',
          )}
        >
          <ToastPrimitive.Description className="min-w-0 flex-1 text-ui text-text">
            {toast.message}
          </ToastPrimitive.Description>
          <ToastPrimitive.Close
            aria-label={copy.toast.close}
            className="rounded-badge p-1 text-text-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2 hover:text-text"
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed right-4 bottom-6 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
