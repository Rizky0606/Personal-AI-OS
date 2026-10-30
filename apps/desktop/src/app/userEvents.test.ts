import type { Task } from '@aios/contracts';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/uiStore';
import { useToastStore } from '../ui/Toaster';
import { handleUserEvent } from './userEvents';

const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const TS = '2026-10-22T06:38:00Z';
const task = (over: Partial<Task>): Task => ({
  id: '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90',
  projectId: PROJECT,
  title: 'Kartu',
  body: '',
  status: 'todo',
  position: 0,
  agentRole: null,
  runId: null,
  branch: null,
  diffStat: null,
  createdAt: TS,
  updatedAt: TS,
  ...over,
});

beforeEach(() => useToastStore.setState({ toasts: [] }));

describe('handleUserEvent', () => {
  it('task.updated mengganti kartu di cache project-nya dan menandai daftar usang', () => {
    const client = new QueryClient();
    client.setQueryData(['tasks', PROJECT], [task({ title: 'Lama' })]);

    handleUserEvent(
      { type: 'task.updated', task: task({ title: 'Baru', status: 'review' }) },
      client,
    );

    expect(client.getQueryData<Task[]>(['tasks', PROJECT])).toEqual([
      task({ title: 'Baru', status: 'review' }),
    ]);
    expect(client.getQueryState(['tasks', PROJECT])?.isInvalidated).toBe(true);
  });

  it('task.updated untuk papan yang belum pernah dibuka tidak membuat cache palsu', () => {
    const client = new QueryClient();

    handleUserEvent({ type: 'task.updated', task: task({}) }, client);

    expect(client.getQueryData(['tasks', PROJECT])).toBeUndefined();
  });

  it('notification error menjadi toast bernada danger; info bernada info', () => {
    const client = new QueryClient();

    handleUserEvent({ type: 'notification', title: 'Kartu gagal', level: 'error' }, client);
    handleUserEvent({ type: 'notification', title: 'Selesai', level: 'info' }, client);

    expect(useToastStore.getState().toasts.map((t) => [t.message, t.tone])).toEqual([
      ['Kartu gagal', 'danger'],
      ['Selesai', 'info'],
    ]);
  });

  it('notifikasi di aplikasi dimatikan: info disembunyikan, error tetap tampil', () => {
    const client = new QueryClient();
    useUiStore.setState({ inAppToasts: false });
    handleUserEvent({ type: 'notification', title: 'Selesai', level: 'info' }, client);
    handleUserEvent({ type: 'notification', title: 'Kartu gagal', level: 'error' }, client);
    useUiStore.setState({ inAppToasts: true });

    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['Kartu gagal']);
  });
});
