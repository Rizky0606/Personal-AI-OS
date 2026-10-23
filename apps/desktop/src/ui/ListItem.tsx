import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ListItemProps {
  title: string;
  supporting?: string;
  trailing?: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

/** Baris 32px (tinggi baris desktop) dengan pemisah 1px; tombol bila bisa diklik. */
export function ListItem({
  title,
  supporting,
  trailing,
  icon,
  selected = false,
  onClick,
}: ListItemProps) {
  const content = (
    <>
      {icon ? <span className="text-text-2">{icon}</span> : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-ui text-text">{title}</span>
        {supporting ? (
          <span className="block truncate text-meta text-text-2">{supporting}</span>
        ) : null}
      </span>
      {trailing ? <span className="text-meta text-text-3">{trailing}</span> : null}
    </>
  );
  const classes = cn(
    'flex min-h-8 w-full items-center gap-2 border-b border-border px-3 py-1',
    selected && 'bg-accent-soft',
    onClick && 'transition-colors duration-[120ms] ease-aios hover:bg-surface-2',
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  ) : (
    <div className={classes}>{content}</div>
  );
}
