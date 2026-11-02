import { useEffect, useState } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { PaneArea } from '../panes/PaneArea';
import { useUiStore } from '../state/uiStore';
import { ISLAND } from './island';
import { ResizeHandle } from './ResizeHandle';

/** Sama dengan durasi `slow` (240 ms): waktu animasi tutup sebelum panel dilepas dari DOM. */
const CLOSE_MS = 240;

/**
 * Panel kanan sebagai pulau: satu pane bertab (atau pohon pane) yang bisa dibagi. Lebar dan tata letak diingat;
 * Ctrl+J membuka/menutup. Yang dianimasikan adalah SLOT pemotong (lebar 0 ke lebar tersimpan + jarak pulau,
 * 240 ms, CSS), sedangkan pulau di dalamnya berlebar tetap dan menempel di kanan. Dengan begitu jarak 8 px ke
 * area utama ikut melebar bersama panel (bukan muncul mendadak sebagai gap flex) dan isi panel tidak berubah
 * susunan selama animasi, jadi area chat bergeser mulus, bukan melompat. Panel baru dilepas setelah animasi tutup
 * selesai, sehingga isinya (terminal, preview) tidak berjalan saat panel tertutup.
 */
export function RightPanel({ open }: { open: boolean }) {
  const width = useUiStore((s) => s.rightPanelWidth);
  const setWidth = useUiStore((s) => s.setRightPanelWidth);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open && !mounted) return null;
  return (
    <div
      data-panel-slot
      style={{ width: `calc(${width}px + var(--aios-island-gap))` }}
      className={cn(
        // -ml meniadakan gap flex kanvas: jarak 8 px sudah ada di dalam slot, jadi tidak menjadi 16 px.
        '-ml-(--aios-island-gap) relative flex shrink-0 justify-end overflow-hidden',
        open ? 'aios-panel-open' : 'aios-panel-close',
      )}
    >
      {open ? (
        // Pegangan berada di celah antar pulau (8 px), jadi tidak menambah jarak.
        <div className="absolute inset-y-0 left-0 z-10 flex w-(--aios-island-gap)">
          <ResizeHandle label={copy.shell.resizePanel} width={width} onResize={setWidth} />
        </div>
      ) : null}
      <aside
        aria-label={copy.shell.toggleRightPanel}
        inert={!open}
        style={{ width }}
        className={cn(ISLAND, 'flex shrink-0 flex-col overflow-hidden')}
      >
        <PaneArea />
      </aside>
    </div>
  );
}
