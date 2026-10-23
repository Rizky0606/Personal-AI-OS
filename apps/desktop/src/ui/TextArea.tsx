import { useId, type Ref, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  /** Pesan error; selalu ditampilkan sebagai teks, tidak hanya warna. */
  error?: string | undefined;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextArea({
  label,
  hint,
  error,
  className,
  rows = 4,
  ref,
  ...props
}: TextAreaProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-meta text-text-2">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        className={cn(
          'resize-y rounded-control border bg-surface px-3 py-2 text-ui text-text placeholder:text-text-3',
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
