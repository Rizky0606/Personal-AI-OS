import type { AppDeps } from '../app.js';
import { createWorkerRelay } from '../modules/worker/relay.js';
import { createWorkerHub } from '../modules/worker/routes.js';
import type { AuthService } from '../modules/auth/service.js';
import type { DevicesService } from '../modules/devices/service.js';

const unused = (name: string) => () =>
  Promise.reject(new Error(`${name} tidak dipakai di tes ini`));

/** Pengganti untuk tes yang tidak menyentuh autentikasi. */
export const unusedAuth: AuthService = {
  login: unused('auth.login'),
  refresh: unused('auth.refresh'),
  logout: unused('auth.logout'),
  registerWorker: unused('auth.registerWorker'),
  authenticate: unused('auth.authenticate'),
  deviceActive: unused('auth.deviceActive'),
};

export const unusedProjects: AppDeps['projects'] = {
  list: unused('projects.list'),
  create: unused('projects.create'),
  update: unused('projects.update'),
  ownedBy: unused('projects.ownedBy'),
  workerOf: unused('projects.workerOf'),
  rulesSection: unused('projects.rulesSection'),
  remove: unused('projects.remove'),
};

export const unusedCompare: AppDeps['compare'] = { run: unused('compare.run') };

export const unusedStatus: AppDeps['status'] = { get: unused('status.get') };

export const unusedSpaces: AppDeps['spaces'] = {
  list: unused('spaces.list'),
  create: unused('spaces.create'),
  update: unused('spaces.update'),
  remove: unused('spaces.remove'),
  documents: unused('spaces.documents'),
  addDocument: unused('spaces.addDocument'),
  removeDocument: unused('spaces.removeDocument'),
  exists: unused('spaces.exists'),
  contextFor: unused('spaces.contextFor'),
};

export const unusedSearch: AppDeps['search'] = { search: unused('search.search') };

export const unusedMemory: AppDeps['memory'] = {
  list: unused('memory.list'),
  create: unused('memory.create'),
  update: unused('memory.update'),
  remove: unused('memory.remove'),
  promptSection: unused('memory.promptSection'),
};

export const unusedTemplates: AppDeps['templates'] = {
  list: unused('templates.list'),
  create: unused('templates.create'),
  update: unused('templates.update'),
  remove: unused('templates.remove'),
};

export const unusedFork: AppDeps['fork'] = { fork: unused('fork.fork') };
export const unusedFleets: AppDeps['fleets'] = { launch: unused('fleets.launch') };

export const unusedHandoff: AppDeps['handoff'] = { run: unused('handoff.run') };

export const unusedOpinion: AppDeps['opinion'] = { run: unused('opinion.run') };

export const unusedTasks: AppDeps['tasks'] = {
  list: unused('tasks.list'),
  create: unused('tasks.create'),
  update: unused('tasks.update'),
  run: unused('tasks.run'),
  breakdown: unused('tasks.breakdown'),
  runChanged: unused('tasks.runChanged'),
  start: unused('tasks.start'),
  idle: unused('tasks.idle'),
};

const stubHub = createWorkerHub();
export const unusedWorker: AppDeps['worker'] = {
  hub: stubHub,
  relay: createWorkerRelay({ hub: stubHub, projects: { workerOf: unused('projects.workerOf') } }),
};

export const unusedChat: AppDeps['chat'] = {
  listConversations: unused('chat.listConversations'),
  getConversation: unused('chat.getConversation'),
  createConversation: unused('chat.createConversation'),
  updateConversation: unused('chat.updateConversation'),
  archiveConversation: unused('chat.archiveConversation'),
  deleteConversation: unused('chat.deleteConversation'),
  listMessages: unused('chat.listMessages'),
  sendMessage: unused('chat.sendMessage'),
  reroute: unused('chat.reroute'),
  editMessage: unused('chat.editMessage'),
  deleteMessage: unused('chat.deleteMessage'),
  exists: unused('chat.exists'),
  idle: unused('chat.idle'),
};

export const unusedFiles: AppDeps['files'] = {
  save: unused('files.save'),
  prepare: unused('files.prepare'),
  saveGenerated: unused('files.saveGenerated'),
  download: unused('files.download'),
};

export const unusedRuns: AppDeps['runs'] = {
  get: unused('runs.get'),
  list: unused('runs.list'),
  events: unused('runs.events'),
  cancel: unused('runs.cancel'),
  resolveApproval: unused('runs.resolveApproval'),
  steer: unused('runs.steer'),
  review: unused('runs.review'),
  exists: unused('runs.exists'),
};

export const unusedWs: AppDeps['ws'] = {
  hub: {
    subscribe: () => () => undefined,
    publishStored: () => undefined,
    publishLive: () => undefined,
  },
  store: { append: unused('store.append'), list: unused('store.list'), head: unused('store.head') },
  exists: { run: unused('ws.exists.run'), conversation: unused('ws.exists.conversation') },
};

export const unusedRouting: AppDeps['routing'] = {
  route: unused('routing.route'),
  preview: unused('routing.preview'),
  assertRoleAllowed: () => {
    throw new Error('routing.assertRoleAllowed tidak dipakai di tes ini');
  },
  record: unused('routing.record'),
  latestDecision: unused('routing.latestDecision'),
  addCorrection: unused('routing.addCorrection'),
};

export const unusedResearch: AppDeps['research'] = {
  start: unused('research.start'),
  create: unused('research.create'),
  list: unused('research.list'),
  get: unused('research.get'),
  cancel: unused('research.cancel'),
  export: unused('research.export'),
  idle: unused('research.idle'),
  close: unused('research.close'),
};

export const unusedSchedules: AppDeps['schedules'] = {
  start: unused('schedules.start'),
  parse: unused('schedules.parse'),
  list: unused('schedules.list'),
  create: unused('schedules.create'),
  update: unused('schedules.update'),
  remove: unused('schedules.remove'),
  runNow: unused('schedules.runNow'),
  history: unused('schedules.history'),
  recordMissed: unused('schedules.recordMissed'),
  idle: unused('schedules.idle'),
  close: unused('schedules.close'),
};

export const unusedRoles: AppDeps['roles'] = {
  list: () => [],
  registry: () => ({ roles: new Map(), skills: new Map() }),
  has: () => false,
  get: () => undefined,
  bundle: () => {
    throw new Error('roles.bundle tidak dipakai di tes ini');
  },
  close: () => undefined,
};

export const unusedLlm: AppDeps['llm'] = {
  client: { request: unused('llm.client.request') },
  models: { list: unused('llm.models.list') },
  quota: { summary: unused('llm.quota.summary') },
  usage: { record: unused('llm.usage.record') },
};

export const unusedDevices: DevicesService = {
  list: unused('devices.list'),
  revoke: unused('devices.revoke'),
  setPushToken: unused('devices.setPushToken'),
};
