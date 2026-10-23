import * as Tabs from '@radix-ui/react-tabs';
import { copy } from '../copy';
import { useUiStore, type RightPanelTab } from '../state/uiStore';
import { PreviewPanel } from '../preview/PreviewPanel';
import { DiffPanel } from '../review/DiffPanel';
import { EmptyState } from '../ui/EmptyState';
import { ResizeHandle } from './ResizeHandle';

const tabs: RightPanelTab[] = ['preview', 'diff', 'terminal', 'files'];

/** Panel kanan bertab (Preview, Diff, Terminal, Berkas). Lebar dan tab terakhir diingat; Ctrl+J membuka/menutup. */
export function RightPanel() {
  const width = useUiStore((s) => s.rightPanelWidth);
  const tab = useUiStore((s) => s.rightPanelTab);
  const setWidth = useUiStore((s) => s.setRightPanelWidth);
  const setTab = useUiStore((s) => s.setRightPanelTab);
  return (
    <>
      <ResizeHandle label={copy.shell.resizePanel} width={width} onResize={setWidth} />
      <aside
        aria-label={copy.shell.toggleRightPanel}
        style={{ width }}
        className="flex shrink-0 flex-col bg-surface"
      >
        <Tabs.Root
          value={tab}
          onValueChange={(v) => setTab(v as RightPanelTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs.List className="flex h-10 shrink-0 items-end gap-1 border-b border-border px-2">
            {tabs.map((id) => (
              <Tabs.Trigger
                key={id}
                value={id}
                className="h-8 rounded-t-control border-b-2 border-transparent px-3 text-ui text-text-2 transition-colors duration-[120ms] ease-aios hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
              >
                {copy.shell.panels[id]}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {tabs.map((id) => (
            <Tabs.Content key={id} value={id} className="min-h-0 flex-1 overflow-auto">
              {id === 'diff' ? (
                <DiffPanel />
              ) : id === 'preview' ? (
                <PreviewPanel />
              ) : (
                <EmptyState message={copy.shell.panelEmpty} />
              )}
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </aside>
    </>
  );
}
