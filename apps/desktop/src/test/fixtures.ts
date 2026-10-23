import type { Message, Run } from '@aios/contracts';

export const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
export const RUN_1 = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
export const RUN_2 = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
export const TS = '2026-10-22T06:38:00Z';

let counter = 0;
/** UUIDv7 palsu yang valid dan unik per panggilan. */
export const uid = (): string => `0192f0c4-7a1b-7c2d-8e3f-${String(++counter).padStart(12, '0')}`;

export function message(
  over: Partial<Message> & Pick<Message, 'author'> & { text?: string },
): Message {
  const { text, ...rest } = over;
  return {
    id: uid(),
    conversationId: CONV,
    parts: text === undefined ? [] : [{ type: 'text', text }],
    agentRole: null,
    model: null,
    runId: null,
    createdAt: TS,
    ...rest,
  };
}

export function run(over: Partial<Run> = {}): Run {
  return {
    id: RUN_1,
    kind: 'chat',
    engine: 'hermes',
    agentRole: null,
    model: null,
    status: 'queued',
    conversationId: CONV,
    taskId: null,
    branch: null,
    usage: null,
    error: null,
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

export const roles = [
  {
    id: 'general',
    name: 'Umum',
    group: 'umum' as const,
    engine: 'hermes' as const,
    model: 'combo/general',
    fallbackModel: null,
    approval: 'ask' as const,
    skills: [],
  },
  {
    id: 'writer',
    name: 'Penulis',
    group: 'umum' as const,
    engine: 'hermes' as const,
    model: 'combo/writer',
    fallbackModel: null,
    approval: 'ask' as const,
    skills: [],
  },
];

export const models = [
  { id: 'combo/fast', label: 'Cepat', kind: 'combo' as const, ownedBy: '9router' },
];
