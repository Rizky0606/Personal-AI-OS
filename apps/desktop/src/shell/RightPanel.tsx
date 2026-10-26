import { copy } from '../copy';
import { PaneArea } from '../panes/PaneArea';
import { useUiStore } from '../state/uiStore';
import { ResizeHandle } from './ResizeHandle';

/** Panel kanan: satu pane bertab (Preview, Diff, Terminal, Berkas) yang bisa dibagi. Lebar dan tata letak diingat; Ctrl+J membuka/menutup. */
export function RightPanel() {
  const width = useUiStore((s) => s.rightPanelWidth);
  const setWidth = useUiStore((s) => s.setRightPanelWidth);
  return (
    <>
      <ResizeHandle label={copy.shell.resizePanel} width={width} onResize={setWidth} />
      <aside
        aria-label={copy.shell.toggleRightPanel}
        style={{ width }}
        className="flex shrink-0 flex-col bg-surface"
      >
        <PaneArea />
      </aside>
    </>
  );
}
