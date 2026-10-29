import { ExternalLink } from 'lucide-react';
import { copy } from '../copy';
import { openExternal } from '../lib/external';
import { enterDelay } from '../screens/PageLayout';

export interface SourceItem {
  key: string;
  /** Nomor rujukan di laporan, bila ada. */
  n?: number | undefined;
  title: string;
  url: string;
  meta?: string | undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Daftar sumber; tiap baris dibuka di peramban sistem. */
export function SourceList({ items }: { items: SourceItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface">
      {items.map((item, index) => (
        <li key={item.key} className="animate-aios-enter" style={enterDelay(index)}>
          <a
            href={item.url}
            rel="noopener noreferrer"
            aria-label={`${copy.research.openSource}: ${item.title || hostOf(item.url)}`}
            onClick={(event) => {
              event.preventDefault();
              void openExternal(item.url);
            }}
            className="flex min-h-9 items-center gap-3 px-4 py-2 text-ui text-text transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
          >
            {item.n !== undefined ? (
              <span className="w-8 shrink-0 font-mono text-meta text-text-2">[{item.n}]</span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.title || hostOf(item.url)}</span>
              <span className="block truncate text-meta text-text-2">
                {item.meta ?? hostOf(item.url)}
              </span>
            </span>
            <ExternalLink
              size={14}
              strokeWidth={1.5}
              aria-hidden="true"
              className="shrink-0 text-text-3"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
