import { useId, type InputHTMLAttributes, type Ref } from 'react';
import { cn } from '../lib/cn';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  /** Pesan error; selalu ditampilkan sebagai teks, tidak hanya warna. */
  error?: string | undefined;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, className, ref, ...props }: TextFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-meta text-text-2">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        className={cn(
          'h-8 rounded-control border bg-surface px-3 text-ui text-text placeholder:text-text-3',
          error ? 'border-danger' : 'border-border focus:border-border-strong',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      {note ? (
        <p id={noteId} className={cn('text-caption', error ? 'text-danger' : 'text-text-3')}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
