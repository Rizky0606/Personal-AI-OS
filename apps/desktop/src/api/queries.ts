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

/** Percakapan satu project; `null` = chat umum (server mengembalikan semua, jadi disaring di layar). */
export const useConversations = (projectId: string | null) =>
  useInfiniteQuery({
    queryKey: ['conversations', projectId ?? 'umum'],
    queryFn: ({ pageParam }) => api.listConversations(pageParam, projectId ?? undefined),
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

/** Kartu satu project; disegarkan oleh event task.updated (lihat RealtimeLifecycle). */
export const useTasks = (projectId: string | null) =>
  useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => api.listTasks(projectId!),
    enabled: projectId !== null,
  });

/** Pemakaian dan kuota; dipakai status bar (ringkas) dan halaman Kuota. */
export const useQuota = () =>
  useQuery({ queryKey: ['quota'], queryFn: api.getQuota, staleTime: MINUTES });

/** Status sistem; disegarkan tiap 15 detik selama halaman Status terbuka. */
export const useSystemStatus = () =>
  useQuery({ queryKey: ['status'], queryFn: api.getStatus, refetchInterval: 15_000 });

export const useMemories = () => useQuery({ queryKey: ['memories'], queryFn: api.listMemories });

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
