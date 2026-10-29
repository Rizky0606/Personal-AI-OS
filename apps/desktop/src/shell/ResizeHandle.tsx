import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { RIGHT_PANEL_MAX, RIGHT_PANEL_MIN } from '../state/uiStore';

export interface ResizeHandleProps {
  label: string;
  width: number;
  onResize: (width: number) => void;
}

const KEY_STEP = 16;
/** Jarak panel kanan dari tepi jendela (mr-2), agar lebar mengikuti pointer. */
const EDGE_GAP = 8;

/**
 * Pegangan di tepi kiri panel kanan. Bisa diseret dengan pointer dan diubah dengan panah kiri/kanan,
 * sehingga lebar panel tetap bisa diatur tanpa mouse.
 */
export function ResizeHandle({ label, width, onResize }: ResizeHandleProps) {
  const dragging = useRef(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onResize(window.innerWidth - event.clientX - EDGE_GAP);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') onResize(width + KEY_STEP);
    else if (event.key === 'ArrowRight') onResize(width - KEY_STEP);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={RIGHT_PANEL_MIN}
      aria-valuemax={RIGHT_PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      className="my-2 w-1 shrink-0 cursor-col-resize rounded-full bg-transparent transition-colors duration-[120ms] ease-aios hover:bg-border-strong"
    />
  );
}
