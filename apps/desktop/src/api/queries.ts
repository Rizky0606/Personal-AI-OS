import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../app/services';

const MINUTES = 60_000;

/** Daftar halaman berbasis kursor `before`, terbaru dulu (urutan server). */
function cursor<P extends { nextBefore: string | null }>(page: P): string | undefined {
  return page.nextBefore ?? undefined;
}

export const useModels = () =>
  useQuery({ queryKey: ['models'], queryFn: api.listModels, staleTime: 5 * MINUTES });

export const useRoles = () =>
  useQuery({ queryKey: ['roles'], queryFn: api.listRoles, staleTime: 5 * MINUTES });

export const useConversations = () =>
  useInfiniteQuery({
    queryKey: ['conversations'],
    queryFn: ({ pageParam }) => api.listConversations(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: cursor,
  });

export const useMessages = (conversationId: string | undefined) =>
  useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) => api.listMessages(conversationId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: cursor,
    enabled: conversationId !== undefined,
  });

export const useSchedules = () => useQuery({ queryKey: ['schedules'], queryFn: api.listSchedules });

export const useScheduleRuns = (scheduleId: string) =>
  useInfiniteQuery({
    queryKey: ['scheduleRuns', scheduleId],
    queryFn: ({ pageParam }) => api.listScheduleRuns(scheduleId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: cursor,
  });

export const useResearchList = () =>
  useInfiniteQuery({
    queryKey: ['research'],
    queryFn: ({ pageParam }) => api.listResearch(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: cursor,
  });

const POLL_MS = 5_000;

/** Job riset; selama masih berjalan disegarkan tiap 5 detik sebagai jaring pengaman bila event WebSocket terlewat. */
export const useResearchJob = (id: string) =>
  useQuery({
    queryKey: ['researchJob', id],
    queryFn: () => api.getResearch(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? POLL_MS : false;
    },
  });
