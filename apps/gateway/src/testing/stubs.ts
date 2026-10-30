import type { AppDeps } from '../app.js';
import { createWorkerRelay } from '../modules/worker/relay.js';
import { createWorkerHub } from '../modules/worker/routes.js';
import type { AuthService } from '../modules/auth/service.js';
import type { DevicesService } from '../modules/devices/service.js';

const unused = (name: string) => () => Promise.reject(new Error(`${name} tidak dipakai di tes ini`));

/** Pengganti untuk tes yang tidak menyentuh autentikasi. */
export const unusedAuth: AuthService = {
  login: unused('auth.login'), refresh: unused('auth.refresh'), logout: unused('auth.logout'),
  registerWorker: unused('auth.registerWorker'), authenticate: unused('auth.authenticate'), deviceActive: unused('auth.deviceActive'),
};
export const unusedDevices: DevicesService = { list: unused('devices.list'), revoke: unused('devices.revoke'), setPushToken: unused('devices.setPushToken') };
export const unusedProjects: AppDeps['projects'] = {
  list: unused('projects.list'), create: unused('projects.create'), update: unused('projects.update'), ownedBy: unused('projects.ownedBy'),
  workerOf: unused('projects.workerOf'), rulesSection: unused('projects.rulesSection'), remove: unused('projects.remove'),
};
export const unusedCompare: AppDeps['compare'] = { run: unused('compare.run') };
export const unusedStatus: AppDeps['status'] = { get: unused('status.get') };
export const unusedSpaces: AppDeps['spaces'] = {
  list: unused('spaces.list'), create: unused('spaces.create'), update: unused('spaces.update'), remove: unused('spaces.remove'),
  documents: unused('spaces.documents'), addDocument: unused('spaces.addDocument'), removeDocument: unused('spaces.removeDocument'),
  exists: unused('spaces.exists'), contextFor: unused('spaces.contextFor'),
};
export const unusedSearch: AppDeps['search'] = { search: unused('search.search') };
export const unusedMemory: AppDeps['memory'] = {
  list: unused('memory.list'), create: unused('memory.create'), update: unused('memory.update'), remove: unused('memory.remove'), promptSection: unused('memory.promptSection'),
};
export const unusedTemplates: AppDeps['templates'] = {
  list: unused('templates.list'), create: unused('templates.create'), update: unused('templates.update'), remove: unused('templates.remove'),
};
export const unusedFork: AppDeps['fork'] = { fork: unused('fork.fork') };
export const unusedFleets: AppDeps['fleets'] = { launch: unused('fleets.launch') };
export const unusedHandoff: AppDeps['handoff'] = { run: unused('handoff.run') };
export const unusedOpinion: AppDeps['opinion'] = { run: unused('opinion.run') };
export const unusedTasks: AppDeps['tasks'] = {
  list: unused('tasks.list'), create: unused('tasks.create'), update: unused('tasks.update'), run: unused('tasks.run'),
  breakdown: unused('tasks.breakdown'), runChanged: unused('tasks.runChanged'), start: unused('tasks.start'), idle: unused('tasks.idle'),
};
const stubHub = createWorkerHub();
export const unusedWorker: AppDeps['worker'] = {
  hub: stubHub,
  relay: createWorkerRelay({ hub: stubHub, projects: { workerOf: unused('projects.workerOf') } }),
};
export const unusedChat: AppDeps['chat'] = {
  listConversations: unused('chat.listConversations'), createConversation: unused('chat.createConversation'), getConversation: unused('chat.getConversation'),
  updateConversation: unused('chat.updateConversation'), archiveConversation: unused('chat.archiveConversation'), deleteConversation: unused('chat.deleteConversation'),
  listMessages: unused('chat.listMessages'), sendMessage: unused('chat.sendMessage'), editMessage: unused('chat.editMessage'), deleteMessage: unused('chat.deleteMessage'),
  exists: unused('chat.exists'), idle: unused('chat.idle'),
};
export const unusedFiles: AppDeps['files'] = {
  save: unused('files.save'), saveGenerated: unused('files.saveGenerated'), download: unused('files.download'), prepare: unused('files.prepare'),
};
export const unusedRuns: AppDeps['runs'] = {
  get: unused('runs.get'),
  list: unused('runs.list'),
  events: unused('runs.events'),
  cancel: unused('runs.cancel'),
  resolveApproval: unused('runs.resolveApproval'),
  steer: unused('runs.steer'),
  answerQuestion: unused('runs.answerQuestion'),
  removeQueued: unused('runs.removeQueued'),
  review: unused('runs.review'),
  exists: unused('runs.exists'),
  projectId: unused('runs.projectId'),
};
export const unusedRoles: AppDeps['roles'] = {
  list: () => [], has: () => false, get: () => undefined, registry: () => ({ roles: new Map(), skills: new Map() }), bundle: () => { throw new Error('roles.bundle tidak dipakai'); }, close: () => undefined,
};
export const unusedResearch: AppDeps['research'] = {
  start: unused('research.start'), create: unused('research.create'), list: unused('research.list'), get: unused('research.get'), cancel: unused('research.cancel'),
  export: unused('research.export'), idle: unused('research.idle'), close: unused('research.close'),
};
export const unusedSchedules: AppDeps['schedules'] = {
  start: unused('schedules.start'), parse: unused('schedules.parse'), list: unused('schedules.list'), create: unused('schedules.create'), update: unused('schedules.update'),
  remove: unused('schedules.remove'), runNow: unused('schedules.runNow'), history: unused('schedules.history'), recordMissed: unused('schedules.recordMissed'), idle: unused('schedules.idle'), close: unused('schedules.close'),
};
export const unusedLlm: AppDeps['llm'] = {
  client: {} as AppDeps['llm']['client'], models: { list: unused('llm.models.list') }, quota: {} as AppDeps['llm']['quota'], usage: {} as AppDeps['llm']['usage'],
};
export const unusedTeams: AppDeps['teams'] = {
  create: unused('teams.create'), list: unused('teams.list'), get: unused('teams.get'), cancel: unused('teams.cancel'), exists: unused('teams.exists'),
};
export const unusedWs: AppDeps['ws'] = {
  hub: { subscribe: () => () => undefined, publishStored: () => undefined, publishLive: () => undefined },
  store: { append: unused('store.append'), list: unused('store.list'), head: unused('store.head') },
  teamStore: { list: unused('teamStore.list'), head: unused('teamStore.head') },
  exists: { run: unused('ws.exists.run'), conversation: unused('ws.exists.conversation'), team: unused('ws.exists.team') },
};
