import { WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { copy } from '../copy';
import { Markdown } from '../markdown/Markdown';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { IconButton } from '../ui/IconButton';
import { TextArea } from '../ui/TextArea';
import type { QuickUpdate } from './protocol';

/** Sambungan jendela Quick Ask ke jendela utama (event Tauri); dipisah supaya komponen bisa dites. */
export interface QuickChannel {
  ask(id: string, text: string): void;
  open(conversationId: string): void;
  hide(): void;
  onUpdate(handler: (update: QuickUpdate) => void): () => void;
  onShown(handler: () => void): () => void;
}

/** Jendela utama tidak menjawab sama sekali dalam selang ini: kemungkinan belum masuk atau belum terbuka. */
export const NO_MAIN_MS = 5_000;

const newId = () => `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * Isi jendela Quick Ask (W20): satu pertanyaan, jawaban yang mengalir, lalu Lanjutkan di chat atau pertanyaan
 * baru. Tidak memegang sesi; semua dikerjakan jendela utama.
 */
export function QuickApp({ channel }: { channel: QuickChannel }) {
  const online = useOnline();
  const [text, setText] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [update, setUpdate] = useState<QuickUpdate | null>(null);
  const [noMain, setNoMain] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const q = copy.quick;

  // Pembaruan untuk pertanyaan lama (sudah diganti pertanyaan baru) diabaikan.
  const pendingRef = useRef<string | null>(null);
  useEffect(
    () =>
      channel.onUpdate((next) => {
        if (pendingRef.current !== next.id) return;
        setUpdate(next);
        setNoMain(false);
      }),
    [channel],
  );

  useEffect(() => channel.onShown(() => field.current?.focus()), [channel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') channel.hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [channel]);

  // Tidak ada kabar sama sekali dari jendela utama: beri tahu alih-alih menunggu selamanya.
  useEffect(() => {
    if (!pendingId || update) return;
    const timer = setTimeout(() => setNoMain(true), NO_MAIN_MS);
    return () => clearTimeout(timer);
  }, [pendingId, update]);

  const busy = update ? update.status === 'sending' || update.status === 'streaming' : !!pendingId;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const question = text.trim();
    if (!question || busy || !online) return;
    const id = newId();
    pendingRef.current = id;
    setPendingId(id);
    setUpdate(null);
    setNoMain(false);
    channel.ask(id, question);
  }

  function reset() {
    setText('');
    pendingRef.current = null;
    setPendingId(null);
    setUpdate(null);
    setNoMain(false);
    field.current?.focus();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-panel border border-border bg-surface">
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center justify-between border-b border-border pr-1 pl-4"
      >
        <h1 data-tauri-drag-region className="text-ui font-semibold text-text">
          {q.title}
        </h1>
        <IconButton label={q.close} onClick={() => channel.hide()}>
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </header>

      <form onSubmit={submit} className="flex shrink-0 flex-col gap-2 p-3">
        <TextArea
          ref={field}
          label={q.label}
          hint={q.hint}
          placeholder={q.placeholder}
          rows={2}
          autoFocus
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {!online ? (
          <p className="flex items-center gap-2 text-meta text-text-2">
            <WifiOff size={14} strokeWidth={1.5} aria-hidden="true" />
            {copy.states.offline}
          </p>
        ) : null}
      </form>

      <section
        aria-label={q.answer}
        aria-live="polite"
        aria-busy={busy}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        {noMain ? (
          <ErrorBanner message={q.noMain} />
        ) : update?.status === 'error' ? (
          <ErrorBanner message={update.error ?? q.failed} />
        ) : update?.text ? (
          <Markdown source={update.text} />
        ) : busy ? (
          <p role="status" className="text-ui text-text-2">
            {q.asking}
          </p>
        ) : null}
      </section>

      {update && !busy ? (
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border p-3">
          <Button variant="ghost" onClick={reset}>
            {q.again}
          </Button>
          {update.conversationId ? (
            <Button variant="primary" onClick={() => channel.open(update.conversationId!)}>
              {q.continueInChat}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
