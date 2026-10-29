import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { IconButton } from '../ui/IconButton';

const widths = {
  sm: 'w-[min(440px,calc(100vw-2rem))]',
  md: 'w-[min(520px,calc(100vw-2rem))]',
  lg: 'w-[min(640px,calc(100vw-2rem))]',
} as const;

export interface DialogFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Satu kalimat penjelasan; tanpa deskripsi, dialog tidak punya aria-describedby. */
  description?: string;
  size?: keyof typeof widths;
  /** Label tombol tutup di pojok kanan atas; tanpa label, tombol tidak dirender. */
  closeLabel?: string;
  /** Aksi di kanan bawah: Batal dulu, aksi primer terakhir. */
  footer?: ReactNode;
  /** Bila ada, isi dan footer dibungkus `<form>`: tombol `type="submit"` di footer dan Enter di kolom berfungsi. */
  onSubmit?: () => void;
  children: ReactNode;
}

/**
 * Tata letak dialog seragam Command Center: judul, deskripsi, isi yang bisa digulir, lalu aksi di kanan bawah
 * di atas garis pemisah. Dialog turun 6px dalam 240 ms (aios-dialog).
 */
export function DialogFrame({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  closeLabel,
  footer,
  onSubmit,
  children,
}: DialogFrameProps) {
  const body = (
    <>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-2">{children}</div>
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
      ) : (
        <div className="h-3" aria-hidden="true" />
      )}
    </>
  );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 animate-aios-fade bg-bg/60" />
        <Dialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed top-20 left-1/2 z-50 flex max-h-[calc(100vh-8rem)] -translate-x-1/2 animate-aios-dialog flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-float',
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-section font-semibold text-text">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-ui text-text-2">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            {closeLabel ? (
              <Dialog.Close asChild>
                <IconButton label={closeLabel} className="-mt-1 -mr-2">
                  <X size={16} strokeWidth={1.5} aria-hidden="true" />
                </IconButton>
              </Dialog.Close>
            ) : null}
          </div>
          {onSubmit ? (
            <form
              className="flex min-h-0 flex-col"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                onSubmit();
              }}
            >
              {body}
            </form>
          ) : (
            body
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
