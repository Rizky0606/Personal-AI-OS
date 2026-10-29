import * as Tabs from '@radix-ui/react-tabs';
import {
  Activity,
  Columns2,
  Eye,
  FolderTree,
  GitBranch,
  GitCompare,
  Rows2,
  SquareTerminal,
  X,
} from 'lucide-react';
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { ActivityPanel } from '../activity/ActivityPanel';
import { FilesPanel } from '../files/FilesPanel';
import { GitPanel } from '../git/GitPanel';
import { PreviewPanel } from '../preview/PreviewPanel';
import { DiffPanel } from '../review/DiffPanel';
import { useUiStore } from '../state/uiStore';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { IconButton } from '../ui/IconButton';
import { PlateGroup } from '../ui/PlateGroup';
import { Tooltip } from '../ui/Tooltip';
import { MAX_PANES, PANE_TABS, ROOT_ID, countPanes, type PaneNode, type PaneTab } from './tree';

const KEY_STEP = 0.05;

function PaneContent({ tab }: { tab: PaneTab }) {
  if (tab === 'diff') return <DiffPanel />;
  if (tab === 'preview') return <PreviewPanel />;
  if (tab === 'terminal') return <TerminalPanel />;
  if (tab === 'activity') return <ActivityPanel />;
  if (tab === 'git') return <GitPanel />;
  return <FilesPanel />;
}

const TAB_ICONS: Record<PaneTab, ReactNode> = {
  preview: <Eye size={14} strokeWidth={1.5} aria-hidden="true" />,
  diff: <GitCompare size={14} strokeWidth={1.5} aria-hidden="true" />,
  terminal: <SquareTerminal size={14} strokeWidth={1.5} aria-hidden="true" />,
  files: <FolderTree size={14} strokeWidth={1.5} aria-hidden="true" />,
  git: <GitBranch size={14} strokeWidth={1.5} aria-hidden="true" />,
  activity: <Activity size={14} strokeWidth={1.5} aria-hidden="true" />,
};

interface LeafProps {
  id: string;
  tab: PaneTab;
  canSplit: boolean;
  canClose: boolean;
}

/** Satu pane: tab Preview/Diff/Terminal/Berkas, tombol bagi ke samping atau ke bawah, dan tutup. */
function Leaf({ id, tab, canSplit, canClose }: LeafProps) {
  const setPaneTab = useUiStore((s) => s.setPaneTab);
  const splitPane = useUiStore((s) => s.splitPane);
  const closePane = useUiStore((s) => s.closePane);
  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => setPaneTab(id, v as PaneTab)}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <Tabs.List className="min-w-0 overflow-x-auto">
          <PlateGroup activeKey={tab} className="flex items-center gap-0.5">
            {PANE_TABS.map((t) => {
              const active = t === tab;
              const trigger = (
                <Tabs.Trigger
                  key={t}
                  value={t}
                  data-plate-key={t}
                  className={cn(
                    'relative z-10 inline-flex h-8 items-center gap-2 rounded-control px-2.5 text-ui whitespace-nowrap transition-colors duration-[120ms] ease-aios',
                    active ? 'text-text' : 'text-text-2 hover:text-text',
                  )}
                >
                  {TAB_ICONS[t]}
                  {/* Aktif: label terlihat. Lain: ikon dengan tooltip; label tetap ada untuk pembaca layar. */}
                  <span className={active ? undefined : 'sr-only'}>{copy.shell.panels[t]}</span>
                </Tabs.Trigger>
              );
              // Selalu dibungkus tooltip (juga yang aktif): pembungkus yang berganti membuat tab dibuat ulang dan fokus hilang.
              return (
                <Tooltip key={t} label={copy.shell.panels[t]} side="bottom">
                  {trigger}
                </Tooltip>
              );
            })}
          </PlateGroup>
        </Tabs.List>
        <div className="flex shrink-0 items-center gap-1">
          {canSplit ? (
            <>
              <IconButton label={copy.panes.splitRow} onClick={() => splitPane(id, 'row')}>
                <Columns2 size={14} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
              <IconButton label={copy.panes.splitColumn} onClick={() => splitPane(id, 'column')}>
                <Rows2 size={14} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </>
          ) : null}
          {canClose ? (
            <IconButton label={copy.panes.close} onClick={() => closePane(id)}>
              <X size={14} strokeWidth={1.5} aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>
      <Tabs.Content value={tab} className="min-h-0 flex-1 overflow-auto">
        <PaneContent tab={tab} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

interface SplitHandleProps {
  direction: 'row' | 'column';
  ratio: number;
  onRatio: (ratio: number) => void;
  container: React.RefObject<HTMLDivElement | null>;
}

/** Pembagi dua pane: diseret dengan pointer atau digeser dengan tombol panah, tanpa mouse pun bisa. */
function SplitHandle({ direction, ratio, onRatio, container }: SplitHandleProps) {
  const dragging = useRef(false);
  const horizontal = direction === 'row';

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return;
    onRatio(
      horizontal
        ? (event.clientX - rect.left) / rect.width
        : (event.clientY - rect.top) / rect.height,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (event.key === back) onRatio(ratio - KEY_STEP);
    else if (event.key === forward) onRatio(ratio + KEY_STEP);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={copy.panes.resize}
      aria-valuemin={15}
      aria-valuemax={85}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragging.current) fromPointer(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'shrink-0 bg-border transition-colors duration-[120ms] ease-aios hover:bg-border-strong',
        horizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
      )}
    />
  );
}

function Node({ node, total }: { node: PaneNode; total: number }) {
  const setPaneRatio = useUiStore((s) => s.setPaneRatio);
  const container = useRef<HTMLDivElement>(null);
  if (node.type === 'leaf') {
    return <Leaf id={node.id} tab={node.tab} canSplit={total < MAX_PANES} canClose={total > 1} />;
  }
  const horizontal = node.direction === 'row';
  return (
    <div
      ref={container}
      className={cn('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col')}
    >
      <div className="flex min-h-0 min-w-0" style={{ flex: `${node.ratio} 1 0%` }}>
        <Node node={node.first} total={total} />
      </div>
      <SplitHandle
        direction={node.direction}
        ratio={node.ratio}
        onRatio={(r) => setPaneRatio(node.id, r)}
        container={container}
      />
      <div className="flex min-h-0 min-w-0" style={{ flex: `${1 - node.ratio} 1 0%` }}>
        <Node node={node.second} total={total} />
      </div>
    </div>
  );
}

/**
 * Isi panel kanan: satu pane (tab tunggal, seperti sebelumnya) atau pohon pane yang dibagi. Tiap pane punya
 * tab sendiri sehingga diff, terminal, dan preview bisa terlihat bersamaan.
 */
export function PaneArea() {
  const tree = useUiStore((s) => s.paneTree);
  const tab = useUiStore((s) => s.rightPanelTab);
  const root: PaneNode = tree ?? { type: 'leaf', id: ROOT_ID, tab };
  return (
    <div className="flex min-h-0 flex-1">
      <Node node={root} total={countPanes(root)} />
    </div>
  );
}
