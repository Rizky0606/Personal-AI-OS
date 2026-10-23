import type { EventEnvelope, ServerEvent } from '@aios/contracts';
import { vi, type Mock } from 'vitest';
import type { GatewayApi } from '../api/gateway';
import { RunTracker } from '../realtime/runTracker';

/**
 * Pengganti `app/services` untuk tes komponen: semua endpoint adalah vi.fn, realtime dapat disuntik event.
 * Pakai: `vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices)`.
 */

type FakeApi = { [K in keyof GatewayApi]: Mock<GatewayApi[K]> };

const handlers = new Map<string, Set<(envelope: EventEnvelope) => void>>();

const signedIn = {
  status: 'signedIn' as const,
  session: { serverUrl: 'https://aios.contoh.com' },
};
const idle = { kind: 'idle' as const };

export const fakeRealtime = {
  subscribe: vi.fn((channel: string, handler: (envelope: EventEnvelope) => void) => {
    let set = handlers.get(channel);
    if (!set) {
      set = new Set();
      handlers.set(channel, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }),
  subscribeState: () => () => undefined,
  getState: () => idle,
};

const fn = <K extends keyof GatewayApi>() => vi.fn() as unknown as FakeApi[K];

export const api: FakeApi = {
  listModels: fn<'listModels'>(),
  listRoles: fn<'listRoles'>(),
  listConversations: fn<'listConversations'>(),
  createConversation: fn<'createConversation'>(),
  updateConversation: fn<'updateConversation'>(),
  archiveConversation: fn<'archiveConversation'>(),
  listMessages: fn<'listMessages'>(),
  sendMessage: fn<'sendMessage'>(),
  rerouteMessage: fn<'rerouteMessage'>(),
  getRun: fn<'getRun'>(),
  cancelRun: fn<'cancelRun'>(),
  listSchedules: fn<'listSchedules'>(),
  createSchedule: fn<'createSchedule'>(),
  updateSchedule: fn<'updateSchedule'>(),
  deleteSchedule: fn<'deleteSchedule'>(),
  parseSchedule: fn<'parseSchedule'>(),
  runScheduleNow: fn<'runScheduleNow'>(),
  listScheduleRuns: fn<'listScheduleRuns'>(),
  createResearch: fn<'createResearch'>(),
  listResearch: fn<'listResearch'>(),
  getResearch: fn<'getResearch'>(),
  cancelResearch: fn<'cancelResearch'>(),
  exportResearch: fn<'exportResearch'>(),
};

export const runs = new RunTracker({
  realtime: fakeRealtime,
  fetchRun: (id) => api.getRun(id),
  onFinished: () => undefined,
});

export const fakeServices = {
  auth: { getState: () => signedIn, subscribe: () => () => undefined },
  realtime: fakeRealtime,
  api,
  runs,
};

/** Mengirim event ke semua pelanggan channel, seolah dari WebSocket. */
export function emit(channel: string, event: ServerEvent, seq = 1): void {
  const envelope = { v: 1, channel, seq, ts: '2026-10-22T06:38:00Z', event } as EventEnvelope;
  handlers.get(channel)?.forEach((handler) => handler(envelope));
}

/** Mengosongkan semua tiruan dan memberi jawaban kosong yang masuk akal untuk daftar. */
export function resetApi(): void {
  for (const mock of Object.values(api)) mock.mockReset();
  fakeRealtime.subscribe.mockClear();
  handlers.clear();
  api.listModels.mockResolvedValue([]);
  api.listRoles.mockResolvedValue([]);
  api.listConversations.mockResolvedValue({ items: [], nextBefore: null });
  api.listResearch.mockResolvedValue({ items: [], nextBefore: null });
  api.listSchedules.mockResolvedValue([]);
}
