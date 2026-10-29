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
 * Ctrl+J membuka/menutup. Membuka melebar dari 0 ke lebar tersimpan dan menutup menyempit lagi (240 ms, CSS),
 * jadi area chat bergeser mulus, bukan melompat. Panel baru dilepas setelah animasi tutup selesai, sehingga isinya
 * (terminal, preview) tidak berjalan saat panel tertutup.
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
    <div className="relative flex shrink-0">
      {open ? (
        // Pegangan berada di celah antar pulau (8 px), jadi tidak menambah jarak.
        <div className="absolute inset-y-0 -left-(--aios-island-gap) z-10 flex w-(--aios-island-gap)">
          <ResizeHandle label={copy.shell.resizePanel} width={width} onResize={setWidth} />
        </div>
      ) : null}
      <aside
        aria-label={copy.shell.toggleRightPanel}
        inert={!open}
        style={{ width }}
        className={cn(
          ISLAND,
          'flex shrink-0 flex-col overflow-hidden',
          open ? 'aios-panel-open' : 'aios-panel-close',
        )}
      >
        <PaneArea />
      </aside>
    </div>
  );
}
