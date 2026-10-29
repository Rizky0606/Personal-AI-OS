import { useCallback, useRef, useState } from 'react';
import { copy } from '../copy';
import { openExternal } from '../lib/external';
import { useUiStore } from '../state/uiStore';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { ErrorBanner } from '../ui/ErrorBanner';
import { SkeletonList } from '../ui/Skeleton';
import { useToastStore } from '../ui/Toaster';
import { workerApi } from '../app/services';
import { toAttachment } from './attachment';
import type { BridgeMessage } from './bridge';
import { ConsolePane, type ConsoleEntry } from './ConsolePane';
import { PreviewFrame, type PreviewSize } from './PreviewFrame';
import { PreviewToolbar } from './PreviewToolbar';
import { usePreview } from './usePreview';

const MAX_ENTRIES = 200;

/** Isi tab Preview: halaman dev server di iframe, ukuran layar, console, dan pilih elemen ke composer. */
export function PreviewPanel() {
  const preview = usePreview();
  const addAttachment = useUiStore((s) => s.addAttachment);
  const push = useToastStore((s) => s.push);
  const [size, setSize] = useState<PreviewSize>('full');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const nextId = useRef(1);
  const { target, info } = preview;
  const p = copy.preview;

  const onMessage = useCallback(
    (message: BridgeMessage) => {
      if (message.type === 'console') {
        setEntries((current) =>
          [...current, { id: nextId.current++, level: message.level, text: message.text }].slice(
            -MAX_ENTRIES,
          ),
        );
      } else if (message.type === 'inspect') {
        setInspecting(message.on);
      } else if (message.type === 'pick' && target) {
        // Tangkapan elemen dari worker hanya pratinjau kecil di composer; kegagalannya tidak menghalangi lampiran.
        void workerApi
          .previewShot({
            ...target,
            selector: message.selector,
            width: Math.round(message.viewport.width),
            height: Math.round(message.viewport.height),
          })
          .then(
            (shot) => `data:image/png;base64,${shot.png}`,
            () => undefined,
          )
          .then((thumbnail) => {
            addAttachment(toAttachment(message, thumbnail));
            push(p.attached);
          });
      } else if (message.type === 'ready') {
        setInspecting(false);
      }
    },
    [target, addAttachment, push, p.attached],
  );

  if (!target) return <EmptyState message={p.noProject} />;
  if (!preview.workerConnected) return <EmptyState message={p.workerOffline} />;
  if (preview.loading) return <SkeletonList rows={3} label={p.loading} />;

  const scope = target.runId ? p.target.run : p.target.project;

  if (preview.starting || info?.status === 'starting') {
    return (
      <div role="status" className="flex animate-aios-enter flex-col gap-2 px-6 py-8">
        <p className="text-ui text-text">{p.starting}</p>
        <p className="max-w-[56ch] text-meta text-text-2">{p.startingHint}</p>
      </div>
    );
  }

  if (info?.status === 'failed' || preview.error) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <ErrorBanner
          message={`${p.failed} ${preview.error ?? info?.error ?? ''}`.trim()}
          action={
            <Button variant="secondary" onClick={() => void preview.start()}>
              {p.retry}
            </Button>
          }
        />
        {info?.log ? (
          <details>
            <summary className="cursor-pointer text-meta text-text-2">{p.showLog}</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-panel border border-border bg-surface-2 p-3 font-mono text-meta whitespace-pre-wrap text-text-2">
              {info.log}
            </pre>
          </details>
        ) : null}
      </div>
    );
  }

  if (info?.status !== 'ready' || !info.url) {
    return (
      <EmptyState
        message={target.runId ? p.idleRun : p.idleProject}
        action={
          <Button variant="primary" onClick={() => void preview.start()}>
            {p.start}
          </Button>
        }
      />
    );
  }

  const url = info.url;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-meta text-text-3">
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-text-2">{scope}</span>
        {info.command ? <span className="min-w-0 truncate font-mono">· {info.command}</span> : null}
      </div>
      <PreviewToolbar
        size={size}
        onSize={setSize}
        inspecting={inspecting}
        onInspect={() => setInspecting((on) => !on)}
        onReload={() => setReloadNonce((n) => n + 1)}
        onOpenBrowser={() => void openExternal(info.devUrl ?? url)}
        onStop={() => void preview.stop()}
      />
      {inspecting ? (
        <p role="status" className="shrink-0 px-3 py-1.5 text-meta text-text-2">
          {p.inspecting}
        </p>
      ) : null}
      <PreviewFrame
        url={url}
        size={size}
        reloadNonce={reloadNonce}
        inspecting={inspecting}
        onMessage={onMessage}
      />
      <ConsolePane entries={entries} onClear={() => setEntries([])} />
    </div>
  );
}
