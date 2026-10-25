import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../app/services';
import { copy } from '../copy';
import type { PaletteItem } from './rank';

/** Jeda mengetik sebelum bertanya ke server. */
export const HISTORY_DEBOUNCE_MS = 250;
const MAX_HISTORY = 8;

/**
 * Pencarian riwayat (W22) untuk palet: pesan chat dan laporan riset dari server yang memuat semua kata query.
 * Hasilnya tidak disaring ulang di klien; urutan relevansi dari server dipertahankan.
 */
export function useHistorySearch(open: boolean, query: string, close: () => void): PaletteItem[] {
  const navigate = useNavigate();
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), HISTORY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  }).data;

  return useMemo(() => {
    if (!results || debounced !== query.trim()) return [];
    return results.slice(0, MAX_HISTORY).map((result): PaletteItem => ({
      id: `history-${result.kind === 'message' ? result.messageId : result.researchId}`,
      group: 'history',
      label: result.snippet || result.title,
      hint: result.kind === 'research' ? copy.palette.historyResearch : result.title || undefined,
      run: () => {
        close();
        if (result.kind === 'message') {
          void navigate({
            to: '/chat/$conversationId',
            params: { conversationId: result.conversationId },
          });
        } else {
          void navigate({ to: '/research/$researchId', params: { researchId: result.researchId } });
        }
      },
    }));
  }, [results, debounced, query, close, navigate]);
}
