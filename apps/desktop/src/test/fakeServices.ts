import type { EventEnvelope, LocalPush, ServerEvent } from '@aios/contracts';
import { vi, type Mock } from 'vitest';
import type { GatewayApi } from '../api/gateway';
import type { WorkerSnapshot } from '../worker/localClient';
import type { WorkerApi } from '../worker/api';
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
  registerWorker: fn<'registerWorker'>(),
  listProjects: fn<'listProjects'>(),
  createProject: fn<'createProject'>(),
  listModels: fn<'listModels'>(),
  listRoles: fn<'listRoles'>(),
  listConversations: fn<'listConversations'>(),
  createConversation: fn<'createConversation'>(),
  updateConversation: fn<'updateConversation'>(),
  archiveConversation: fn<'archiveConversation'>(),
  listMessages: fn<'listMessages'>(),
  sendMessage: fn<'sendMessage'>(),
  uploadFile: fn<'uploadFile'>(),
  rerouteMessage: fn<'rerouteMessage'>(),
  editMessage: fn<'editMessage'>(),
  deleteMessage: fn<'deleteMessage'>(),
  getRun: fn<'getRun'>(),
  resolveApproval: fn<'resolveApproval'>(),
  reviewRun: fn<'reviewRun'>(),
  cancelRun: fn<'cancelRun'>(),
  getStatus: fn<'getStatus'>(),
  getQuota: fn<'getQuota'>(),
  compareModels: fn<'compareModels'>(),
  listTasks: fn<'listTasks'>(),
  createTask: fn<'createTask'>(),
  updateTask: fn<'updateTask'>(),
  runTask: fn<'runTask'>(),
  breakdownTasks: fn<'breakdownTasks'>(),
  listSpaces: fn<'listSpaces'>(),
  createSpace: fn<'createSpace'>(),
  updateSpace: fn<'updateSpace'>(),
  deleteSpace: fn<'deleteSpace'>(),
  listSpaceDocuments: fn<'listSpaceDocuments'>(),
  addSpaceDocument: fn<'addSpaceDocument'>(),
  deleteSpaceDocument: fn<'deleteSpaceDocument'>(),
  listSpaceConversations: fn<'listSpaceConversations'>(),
  listMemories: fn<'listMemories'>(),
  createMemory: fn<'createMemory'>(),
  updateMemory: fn<'updateMemory'>(),
  deleteMemory: fn<'deleteMemory'>(),
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

/** Worker lokal palsu: snapshot bisa diatur tes lewat [setWorker]. */
let workerSnapshot: WorkerSnapshot = { local: 'off', status: null };
const workerListeners = new Set<() => void>();
export const localWorker = {
  subscribe: (listener: () => void) => {
    workerListeners.add(listener);
    return () => workerListeners.delete(listener);
  },
  getSnapshot: () => workerSnapshot,
  start: vi.fn(),
  stop: vi.fn(),
  call: vi.fn(),
  onPush: (listener: (push: LocalPush) => void) => {
    pushListeners.add(listener);
    return () => pushListeners.delete(listener);
  },
};

const pushListeners = new Set<(push: LocalPush) => void>();
/** Mengirim dorongan worker (mis. preview.state) ke pendengar, seolah dari WebSocket lokal. */
export function emitPush(push: LocalPush): void {
  pushListeners.forEach((listener) => listener(push));
}
export function setWorker(next: WorkerSnapshot): void {
  workerSnapshot = next;
  workerListeners.forEach((listener) => listener());
}

type FakeWorkerApi = { [K in keyof WorkerApi]: Mock<WorkerApi[K]> };
export const workerApi: FakeWorkerApi = {
  folders: vi.fn(),
  addFolder: vi.fn(),
  removeFolder: vi.fn(),
  inspect: vi.fn(),
  bind: vi.fn(),
  bindings: vi.fn(),
  reviewGet: vi.fn(),
  reviewUndo: vi.fn(),
  reviewRevertFile: vi.fn(),
  previewStart: vi.fn(),
  previewGet: vi.fn(),
  previewStop: vi.fn(),
  previewShot: vi.fn(),
  terminalOpen: vi.fn(),
  terminalWrite: vi.fn(),
  terminalResize: vi.fn(),
  terminalClose: vi.fn(),
};
export const workerService = { start: vi.fn(), stop: vi.fn() };

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
  localWorker,
  workerApi,
  workerService,
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
  api.listMemories.mockResolvedValue([]);
  api.listSpaces.mockResolvedValue([]);
  api.listSpaceDocuments.mockResolvedValue([]);
  api.listSpaceConversations.mockResolvedValue({ items: [], nextBefore: null });
  api.listProjects.mockResolvedValue([]);
  for (const mock of Object.values(workerApi)) mock.mockReset();
  workerApi.folders.mockResolvedValue([]);
  workerApi.bindings.mockResolvedValue([]);
  pushListeners.clear();
  setWorker({ local: 'off', status: null });
}
