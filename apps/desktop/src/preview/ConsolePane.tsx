import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';

export interface ConsoleEntry {
  id: number;
  level: string;
  text: string;
}

export interface ConsolePaneProps {
  entries: ConsoleEntry[];
  onClear: () => void;
}

const isError = (level: string) => level === 'error';

/** Console halaman preview: pesan terbaru di bawah; error ditandai teks dan warna. Bisa dilipat. */
export function ConsolePane({ entries, onClear }: ConsolePaneProps) {
  const [open, setOpen] = useState(true);
  const errors = entries.filter((e) => isError(e.level)).length;
  const c = copy.preview.console;
  return (
    <section
      aria-label={c.title}
      className="flex max-h-48 shrink-0 flex-col border-t border-border"
    >
      <div className="flex h-8 items-center justify-between px-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={c.toggle}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-meta font-medium text-text"
        >
          {open ? (
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronUp size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
          {c.title}
          <span className={cn('font-normal', errors > 0 ? 'text-danger' : 'text-text-2')}>
            · {c.errors(errors)}
          </span>
        </button>
        {open && entries.length > 0 ? (
          <Button variant="ghost" onClick={onClear} className="h-6 px-2 text-meta">
            {c.clear}
          </Button>
        ) : null}
      </div>
      {open ? (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 font-mono text-meta">
          {entries.length === 0 ? (
            <li className="font-sans text-text-3">{c.empty}</li>
          ) : (
            entries.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  'border-b border-border py-1 break-words whitespace-pre-wrap',
                  isError(entry.level)
                    ? 'text-danger'
                    : entry.level === 'warn'
                      ? 'text-warning'
                      : 'text-text-2',
                )}
              >
                <span className="mr-2 text-text-3">{entry.level}</span>
                {entry.text}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </section>
  );
}
