import * as Dialog from '@radix-ui/react-dialog';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { rank, type PaletteGroup } from '../palette/rank';
import { useHistorySearch } from '../palette/useHistorySearch';
import { usePaletteItems } from '../palette/usePaletteItems';
import { useUiStore } from '../state/uiStore';

/**
 * Palet perintah (Ctrl+K): cari percakapan, project, kartu, jadwal, atau jalankan perintah. Sepenuhnya
 * lewat keyboard: ketik untuk menyaring, panah untuk memilih, Enter menjalankan, Esc menutup.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), [setOpen]);
  const items = usePaletteItems(open, close);
  const history = useHistorySearch(open, query, close);
  // Hasil riwayat dari server menyusul di akhir, tanpa disaring ulang (server sudah mencocokkan semua kata).
  const results = useMemo(() => [...rank(items, query), ...history], [items, query, history]);
  const current = results[Math.min(active, results.length - 1)];

  // Setiap dibuka mulai dari kosong.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // Item terpilih selalu terlihat.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, results]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      current?.run();
    }
  }

  let lastGroup: PaletteGroup | null = null;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/60" />
        <Dialog.Content
          aria-describedby={`${id}-hint`}
          className="fixed top-24 left-1/2 z-50 flex max-h-[min(28rem,calc(100vh-8rem))] w-[min(600px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-float"
        >
          <Dialog.Title className="sr-only">{copy.palette.title}</Dialog.Title>
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={current ? `${id}-${current.id}` : undefined}
            aria-label={copy.palette.input}
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={copy.palette.placeholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-12 shrink-0 border-b border-border bg-transparent px-4 text-chat text-text outline-none placeholder:text-text-3"
          />
          <ul
            id={`${id}-list`}
            ref={list}
            role="listbox"
            aria-label={copy.palette.results}
            className="min-h-0 flex-1 overflow-y-auto p-1"
          >
            {results.length === 0 ? (
              <li role="presentation" className="px-3 py-4 text-ui text-text-2">
                {copy.palette.empty}
              </li>
            ) : (
              results.map((item, index) => {
                const heading = item.group !== lastGroup;
                lastGroup = item.group;
                const selected = item === current;
                return (
                  <Fragment key={item.id}>
                    {heading ? (
                      <li
                        role="presentation"
                        className="px-3 pt-2 pb-1 text-caption font-medium text-text-3"
                      >
                        {copy.palette.groups[item.group]}
                      </li>
                    ) : null}
                    <li
                      id={`${id}-${item.id}`}
                      role="option"
                      aria-selected={selected}
                      onMouseMove={() => setActive(index)}
                      onClick={item.run}
                      className={cn(
                        'flex h-8 cursor-pointer items-center justify-between gap-3 rounded-control px-3 text-ui text-text',
                        selected && 'bg-accent-soft',
                      )}
                    >
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.hint ? (
                        <span
                          className={cn(
                            'shrink-0 font-mono text-caption',
                            // text-3 tidak cukup kontras di atas latar terpilih (accent-soft).
                            selected ? 'text-text-2' : 'text-text-3',
                          )}
                        >
                          {item.hint}
                        </span>
                      ) : null}
                    </li>
                  </Fragment>
                );
              })
            )}
          </ul>
          <p
            id={`${id}-hint`}
            className="shrink-0 border-t border-border px-4 py-2 text-caption text-text-3"
          >
            {copy.palette.hint}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
