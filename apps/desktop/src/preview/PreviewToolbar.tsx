import { ExternalLink, MousePointerClick, RotateCw, Square } from 'lucide-react';
import { copy } from '../copy';
import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/IconButton';
import type { PreviewSize } from './PreviewFrame';

const SIZES: PreviewSize[] = ['phone', 'tablet', 'full'];

export interface PreviewToolbarProps {
  size: PreviewSize;
  onSize: (size: PreviewSize) => void;
  inspecting: boolean;
  onInspect: () => void;
  onReload: () => void;
  onOpenBrowser: () => void;
  onStop: () => void;
}

/** Ukuran layar, muat ulang, pilih elemen, buka di browser, dan hentikan. Semua tombol punya nama untuk pembaca layar. */
export function PreviewToolbar({
  size,
  onSize,
  inspecting,
  onInspect,
  onReload,
  onOpenBrowser,
  onStop,
}: PreviewToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1">
      <div role="group" aria-label={copy.preview.sizes.label} className="flex items-center gap-1">
        {SIZES.map((id) => (
          <Chip key={id} selected={size === id} onClick={() => onSize(id)}>
            {copy.preview.sizes[id]}
          </Chip>
        ))}
      </div>
      <span className="ml-auto flex items-center gap-1">
        <IconButton label={copy.preview.inspect} active={inspecting} onClick={onInspect}>
          <MousePointerClick size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <IconButton label={copy.preview.reload} onClick={onReload}>
          <RotateCw size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <IconButton label={copy.preview.openBrowser} onClick={onOpenBrowser}>
          <ExternalLink size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <IconButton label={copy.preview.stop} onClick={onStop}>
          <Square size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </span>
    </div>
  );
}
