import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn } from '../lib/cn';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const same = (a: Box | null, b: Box | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height);

const boxOf = (el: HTMLElement | null | undefined): Box | null =>
  el ? { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight } : null;

export interface PlateGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Nilai `data-plate-key` item aktif; null bila tidak ada yang aktif. */
  activeKey: string | null;
  children: ReactNode;
}

/**
 * Pelat penanda yang meluncur antar item (daftar navigasi, tab). Item menandai diri dengan `data-plate-key`;
 * posisi pelat dihitung dari item aktif (offset terhadap wadah), lalu CSS yang menggerakkan (transform 240 ms,
 * kurva pegas dari token). Pelat kedua menyusul kursor (glide 120 ms). Pengukuran pertama tanpa transisi,
 * supaya pelat tidak meluncur dari pojok saat dimuat. `prefers-reduced-motion` mematikan transisinya lewat CSS.
 */
export function PlateGroup({ activeKey, className, children, ...rest }: PlateGroupProps) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Box | null>(null);
  const [hover, setHover] = useState<Box | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const root = container.current;
    const el =
      root && activeKey !== null
        ? Array.from(root.querySelectorAll<HTMLElement>('[data-plate-key]')).find(
            (candidate) => candidate.dataset.plateKey === activeKey,
          )
        : undefined;
    const next = boxOf(el);
    setActive((prev) => (same(prev, next) ? prev : next));
  }, [activeKey]);

  // Setiap render: isi item (mis. lebar saat sidebar diciutkan) bisa berubah tanpa activeKey berubah.
  useLayoutEffect(measure);

  useEffect(() => {
    const root = container.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  // Transisi baru aktif setelah ukuran pertama diterapkan.
  useEffect(() => {
    if (active !== null && !ready) setReady(true);
  }, [active, ready]);

  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-plate-key]');
    if (!item || !container.current?.contains(item)) return;
    setHover(boxOf(item));
    setHoverKey(item.dataset.plateKey ?? null);
  };
  const onPointerLeave = () => {
    setHover(null);
    setHoverKey(null);
  };

  const plate = (box: Box | null) => ({
    transform: box ? `translate(${box.x}px, ${box.y}px)` : undefined,
    width: box?.width,
    height: box?.height,
  });

  return (
    <div
      ref={container}
      onPointerOver={onPointerOver}
      onPointerLeave={onPointerLeave}
      className={cn('relative', className)}
      {...rest}
    >
      <span
        aria-hidden="true"
        data-plate="hover"
        data-ready={ready}
        data-visible={hover !== null && hoverKey !== activeKey}
        style={plate(hover)}
        className="aios-plate bg-surface-2"
      />
      <span
        aria-hidden="true"
        data-plate="active"
        data-ready={ready}
        data-visible={active !== null}
        style={plate(active)}
        className="aios-plate bg-accent-soft shadow-layer-1"
      />
      {children}
    </div>
  );
}
