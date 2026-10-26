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

export const useSpaces = () => useQuery({ queryKey: ['spaces'], queryFn: api.listSpaces });

export const useSpaceDocuments = (spaceId: string) =>
  useQuery({
    queryKey: ['spaceDocuments', spaceId],
    queryFn: () => api.listSpaceDocuments(spaceId),
  });

export const useSpaceConversations = (spaceId: string) =>
  useQuery({
    queryKey: ['spaceConversations', spaceId],
    queryFn: async () => (await api.listSpaceConversations(spaceId)).items,
  });

export const useMemories = () => useQuery({ queryKey: ['memories'], queryFn: api.listMemories });

/** Run coding untuk Ruang Kerja; dimuat ulang tiap 5 detik selama ada run yang belum final. */
export const useWorkspaceRuns = () =>
  useQuery({
    queryKey: ['workspaceRuns'],
    queryFn: api.listRuns,
    refetchInterval: (query) =>
      query.state.data?.some(
        (i) => !['accepted', 'rejected', 'completed', 'failed', 'cancelled'].includes(i.run.status),
      )
        ? 5_000
        : false,
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
