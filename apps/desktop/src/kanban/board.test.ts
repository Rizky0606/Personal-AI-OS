import type { Task } from '@aios/contracts';
import { describe, expect, it } from 'vitest';
import {
  canDrop,
  dropPlacement,
  formatDiffStat,
  groupTasks,
  isLocked,
  isQueued,
  stepPlacement,
  upsertTask,
} from './board';

const TS = '2026-10-22T06:38:00Z';
let counter = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `0192f0c4-7a1b-7c2d-8e3f-${String(++counter).padStart(12, '0')}`,
  projectId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
  title: 'Kartu',
  body: '',
  status: 'backlog',
  position: 0,
  agentRole: null,
  runId: null,
  branch: null,
  diffStat: null,
  createdAt: TS,
  updatedAt: TS,
  ...over,
});

describe('groupTasks', () => {
  it('mengelompokkan per kolom dan mengurutkan menurut posisi', () => {
    const a = task({ title: 'A', status: 'todo', position: 1 });
    const b = task({ title: 'B', status: 'todo', position: 0 });
    const c = task({ title: 'C', status: 'done' });

    const board = groupTasks([a, b, c]);

    expect(board.todo.map((t) => t.title)).toEqual(['B', 'A']);
    expect(board.done.map((t) => t.title)).toEqual(['C']);
    expect(board.backlog).toEqual([]);
  });
});

describe('status kartu', () => {
  it('antre = Running tanpa run; terkunci = Running dengan run', () => {
    const queued = task({ status: 'running', runId: null });
    const active = task({ status: 'running', runId: 'r1' });
    expect([isQueued(queued), isLocked(queued)]).toEqual([true, false]);
    expect([isQueued(active), isLocked(active)]).toEqual([false, true]);
    expect([isQueued(task()), isLocked(task())]).toEqual([false, false]);
  });

  it('hanya Backlog, Todo, dan Done yang menerima lepasan; kartu terkunci tidak bisa dipindah', () => {
    const idle = task({ status: 'review', runId: 'r1' });
    expect(canDrop(idle, 'todo')).toBe(true);
    expect(canDrop(idle, 'done')).toBe(true);
    expect(canDrop(idle, 'running')).toBe(false);
    expect(canDrop(idle, 'review')).toBe(false);
    expect(canDrop(task({ status: 'running', runId: 'r1' }), 'todo')).toBe(false);
    expect(canDrop(task({ status: 'running', runId: null }), 'todo')).toBe(true);
  });
});

describe('dropPlacement', () => {
  const a = task({ title: 'A', status: 'todo', position: 0 });
  const b = task({ title: 'B', status: 'todo', position: 1 });
  const c = task({ title: 'C', status: 'todo', position: 2 });
  const x = task({ title: 'X', status: 'backlog' });
  const board = groupTasks([a, b, c, x]);

  it('di ruang kosong kolom: paling bawah', () => {
    expect(dropPlacement(board, x.id, 'todo')).toEqual({ status: 'todo', position: 3 });
  });

  it('di atas kartu lain: sebelum kartu itu', () => {
    expect(dropPlacement(board, x.id, 'todo', b.id)).toEqual({ status: 'todo', position: 1 });
  });

  it('dalam kolom yang sama indeks dihitung tanpa kartu yang dipindah (aturan server)', () => {
    // A dilepas di atas C: tanpa A kolom jadi [B, C]; sebelum C = indeks 1.
    expect(dropPlacement(board, a.id, 'todo', c.id)).toEqual({ status: 'todo', position: 1 });
  });
});

describe('stepPlacement (alternatif keyboard)', () => {
  const a = task({ title: 'A', status: 'todo', position: 0 });
  const b = task({ title: 'B', status: 'todo', position: 1 });
  const r = task({ title: 'R', status: 'review', runId: 'r1' });
  const board = groupTasks([a, b, r]);

  it('naik dan turun menggeser satu urutan; di ujung tidak ada tempat', () => {
    expect(stepPlacement(board, b, 'up')).toEqual({ status: 'todo', position: 0 });
    expect(stepPlacement(board, a, 'down')).toEqual({ status: 'todo', position: 1 });
    expect(stepPlacement(board, a, 'up')).toBeNull();
    expect(stepPlacement(board, b, 'down')).toBeNull();
  });

  it('kiri dan kanan melewati Running dan Review', () => {
    expect(stepPlacement(board, a, 'left')).toEqual({ status: 'backlog', position: 0 });
    expect(stepPlacement(board, a, 'right')).toEqual({ status: 'done', position: 0 });
    // Dari Review (kartu menunggu tinjauan) tetap bisa digeser ke Todo atau Done.
    expect(stepPlacement(board, r, 'left')).toEqual({ status: 'todo', position: 2 });
    expect(stepPlacement(board, r, 'right')).toEqual({ status: 'done', position: 0 });
  });

  it('tidak ada kolom di luar Backlog dan Done; kartu yang sedang dikerjakan tidak bergerak', () => {
    const first = task({ status: 'backlog' });
    expect(stepPlacement(groupTasks([first]), first, 'left')).toBeNull();
    const done = task({ status: 'done' });
    expect(stepPlacement(groupTasks([done]), done, 'right')).toBeNull();
    const active = task({ status: 'running', runId: 'r1' });
    expect(stepPlacement(groupTasks([active]), active, 'left')).toBeNull();
  });
});

describe('upsertTask dan formatDiffStat', () => {
  it('mengganti kartu yang ada dan menambah kartu baru', () => {
    const a = task({ title: 'A' });
    const updated = { ...a, title: 'A2' };
    const fresh = task({ title: 'Baru' });
    expect(upsertTask([a], updated)).toEqual([updated]);
    expect(upsertTask([a], fresh)).toEqual([a, fresh]);
  });

  it('diff stat mono: +tambah −hapus; kosong bila tidak ada perubahan', () => {
    expect(formatDiffStat({ files: 2, additions: 12, deletions: 3 })).toBe('+12 −3');
    expect(formatDiffStat({ files: 0, additions: 0, deletions: 0 })).toBeNull();
    expect(formatDiffStat(null)).toBeNull();
  });
});
