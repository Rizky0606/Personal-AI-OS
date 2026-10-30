import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { localWorker, workerApi } from '../app/services';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { workerErrorMessage } from '../worker/errors';
import { ErrorBanner } from '../ui/ErrorBanner';

export interface TerminalViewProps {
  projectId: string;
  runId?: string | undefined;
}

/** Warna terminal dari token tema yang aktif (tanpa nilai tetap di komponen). */
function themeFromTokens(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: token('--aios-bg'),
    foreground: token('--aios-text'),
    cursor: token('--aios-accent'),
    selectionBackground: token('--aios-accent-soft'),
  };
}

/**
 * Satu terminal xterm.js yang tersambung ke PTY di worker. Keluaran didorong worker; ketikan dikirim apa adanya.
 * Meninggalkan tab hanya melepas tampilan: shell tetap hidup di worker dan riwayatnya dimuat saat dibuka lagi.
 */
export function TerminalView({ projectId, runId }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState<number | null | false>(false);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setError(null);
    setExited(false);
    const term = new Terminal({
      fontFamily: 'IBM Plex Mono, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: themeFromTokens(),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    fit.fit();

    let id: string | null = null;
    let disposed = false;
    const unsubscribers: (() => void)[] = [];

    void workerApi
      .terminalOpen({ projectId, ...(runId ? { runId } : {}), cols: term.cols, rows: term.rows })
      .then((info) => {
        if (disposed) return;
        id = info.id;
        setTerminalId(info.id);
        if (info.replay) term.write(info.replay);
        if (info.exitCode !== null) setExited(info.exitCode);
        unsubscribers.push(
          localWorker.onPush((push) => {
            if (push.push === 'terminal.data' && push.terminalId === id) term.write(push.data);
            else if (push.push === 'terminal.exit' && push.terminalId === id)
              setExited(push.exitCode);
          }),
        );
        const input = term.onData(
          (data) => void workerApi.terminalWrite(info.id, data).catch(() => undefined),
        );
        unsubscribers.push(() => input.dispose());
        term.focus();
      })
      .catch((e: unknown) => {
        if (!disposed) setError(workerErrorMessage(e));
      });

    const observer = new ResizeObserver(() => {
      fit.fit();
      if (id) void workerApi.terminalResize(id, term.cols, term.rows).catch(() => undefined);
    });
    observer.observe(element);

    return () => {
      disposed = true;
      observer.disconnect();
      for (const off of unsubscribers) off();
      term.dispose();
    };
  }, [projectId, runId, attempt]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-meta text-text-2">
          {runId ? copy.terminal.scope.run : copy.terminal.scope.project}
        </span>
        {terminalId ? (
          <IconButton
            label={copy.terminal.close}
            onClick={() => {
              void workerApi.terminalClose(terminalId).then(() => setAttempt((n) => n + 1));
            }}
          >
            <Square size={14} strokeWidth={1.5} aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      {error ? (
        <div className="p-3">
          <ErrorBanner
            message={error}
            action={
              <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                {copy.terminal.retry}
              </Button>
            }
          />
        </div>
      ) : null}
      {exited !== false ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 px-3 pt-3 text-meta text-text-2"
        >
          {copy.terminal.exited(exited)}
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {copy.terminal.restart}
          </Button>
        </div>
      ) : null}
      <div
        ref={host}
        role="group"
        aria-label={copy.terminal.label}
        className={cn(
          'm-3 min-h-0 flex-1 overflow-hidden rounded-panel border border-border bg-bg px-3 py-2',
          error && 'hidden',
        )}
      />
    </div>
  );
}
