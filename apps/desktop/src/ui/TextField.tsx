import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from '../lib/cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  /** Pesan error; selalu ditampilkan sebagai teks, tidak hanya warna. */
  error?: string | undefined;
  /** Kontrol di dalam ruas input, rata kanan (mis. tombol tampilkan password). Input memberi ruang kanan. */
  trailing?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  hint,
  error,
  trailing,
  className,
  ref,
  ...props
}: TextFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const input = (
    <input
      id={id}
      ref={ref}
      aria-invalid={error ? true : undefined}
      aria-describedby={note ? noteId : undefined}
      className={cn(
        'h-8 rounded-control border bg-surface px-3 text-ui text-text placeholder:text-text-3',
        error ? 'border-danger' : 'border-border focus:border-border-strong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        trailing ? 'w-full pr-10' : false,
        className,
      )}
      {...props}
    />
  );
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-meta text-text-2">
        {label}
      </label>
      {trailing ? (
        <div className="relative">
          {input}
          <div className="absolute right-0 top-0 flex h-8 items-center">{trailing}</div>
        </div>
      ) : (
        input
      )}
      {note ? (
        <p id={noteId} className={cn('text-caption', error ? 'text-danger' : 'text-text-3')}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
