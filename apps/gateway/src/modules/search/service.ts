import type { SearchResult } from '@aios/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { keywords } from '../spaces/service.js';

export interface SearchService {
  /** Pesan chat (percakapan aktif) dan laporan riset yang memuat semua kata kunci, paling relevan dulu. */
  search(text: string, limit: number): Promise<SearchResult[]>;
}

/** Kata kunci sebagai tsquery AND dengan pencocokan awalan; null bila tidak ada kata yang bisa dicari. */
export function searchQuery(text: string): string | null {
  const words = keywords(text);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/** Opsi ts_headline: satu potongan pendek di sekitar kata yang cocok, tanpa tag sorotan. */
const HEADLINE = 'MaxWords=24, MinWords=10, MaxFragments=1, StartSel="", StopSel=""';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Pencarian riwayat (W22) dengan full-text Postgres `simple` tanpa indeks tambahan: data satu pemilik cukup kecil
 * untuk dihitung saat kueri. Teks pesan diambil dari bagian `text` di kolom parts (jsonb).
 */
export function createSearchService(deps: { db: Database }): SearchService {
  const { db } = deps;

  return {
    async search(text, limit) {
      const query = searchQuery(text);
      if (!query) return [];

      const messages = await db.execute<{
        message_id: string;
        conversation_id: string;
        title: string;
        snippet: string;
        created_at: Date;
        rank: number;
      }>(sql`
        with q as (select to_tsquery('simple', ${query}) as query)
        select m.id as message_id, m.conversation_id, c.title, m.created_at,
          ts_headline('simple', t.body, q.query, ${HEADLINE}) as snippet,
          ts_rank_cd(to_tsvector('simple', t.body), q.query) as rank
        from messages m
        join conversations c on c.id = m.conversation_id
        cross join lateral (
          select string_agg(p->>'text', ' ') as body
          from jsonb_array_elements(m.parts) p
          where p->>'type' = 'text'
        ) t
        cross join q
        where c.archived_at is null
          and t.body is not null
          and to_tsvector('simple', t.body) @@ q.query
        order by rank desc, m.id desc
        limit ${limit}`);

      const research = await db.execute<{
        id: string;
        question: string;
        snippet: string;
        created_at: Date;
        rank: number;
      }>(sql`
        with q as (select to_tsquery('simple', ${query}) as query)
        select r.id, r.question, r.created_at,
          ts_headline('simple', r.question || ' ' || coalesce(r.report_md, ''), q.query, ${HEADLINE}) as snippet,
          ts_rank_cd(to_tsvector('simple', r.question || ' ' || coalesce(r.report_md, '')), q.query) as rank
        from research_jobs r cross join q
        where to_tsvector('simple', r.question || ' ' || coalesce(r.report_md, '')) @@ q.query
        order by rank desc, r.id desc
        limit ${limit}`);

      const results: { rank: number; item: SearchResult }[] = [
        ...messages.rows.map((row) => ({
          rank: Number(row.rank),
          item: {
            kind: 'message' as const,
            messageId: row.message_id,
            conversationId: row.conversation_id,
            title: row.title,
            snippet: oneLine(row.snippet),
            createdAt: new Date(row.created_at).toISOString(),
          },
        })),
        ...research.rows.map((row) => ({
          rank: Number(row.rank),
          item: {
            kind: 'research' as const,
            researchId: row.id,
            title: row.question,
            snippet: oneLine(row.snippet),
            createdAt: new Date(row.created_at).toISOString(),
          },
        })),
      ];
      return results
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit)
        .map((r) => r.item);
    },
  };
}
