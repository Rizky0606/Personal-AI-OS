import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { enterProps } from './enter';

export interface ListItemProps {
  title: string;
  supporting?: string;
  trailing?: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** Urutan di daftar: 8 item pertama masuk bergantian (40 ms). */
  index?: number;
}

/** Baris 36px dengan pemisah halus; aktif: garis aksen kiri dan latar `accent-soft`; tombol bila bisa diklik. */
export function ListItem({
  title,
  supporting,
  trailing,
  icon,
  selected = false,
  onClick,
  index,
}: ListItemProps) {
  const content = (
    <>
      {icon ? <span className="shrink-0 text-text-2">{icon}</span> : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-ui text-text">{title}</span>
        {supporting ? (
          <span className="block truncate text-meta text-text-2">{supporting}</span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0 text-meta text-text-3">{trailing}</span> : null}
    </>
  );
  const enter = index === undefined ? {} : enterProps(index);
  const classes = cn(
    'flex min-h-9 w-full items-center gap-3 border-b border-l-2 border-b-border px-3 py-1.5',
    selected ? 'border-l-accent bg-accent-soft' : 'border-l-transparent',
    onClick && 'transition-colors duration-[120ms] ease-aios',
    onClick && !selected && 'hover:bg-surface-2',
  );
  return onClick ? (
    <button type="button" onClick={onClick} style={enter.style} className={classes}>
      {content}
    </button>
  ) : (
    <div style={enter.style} className={classes}>
      {content}
    </div>
  );
}
