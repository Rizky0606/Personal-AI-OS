import { describe, expect, it } from 'vitest';
import { run } from '../test/fixtures';
import {
  countRuns,
  filterRuns,
  isCancellable,
  isLiveRun,
  statusDotClass,
  type WorkspaceRun,
} from './runs';

const item = (status: WorkspaceRun['run']['status'], id: string): WorkspaceRun => ({
  run: run({ id, status, kind: 'coding' }),
  title: id,
  projectId: null,
  projectName: null,
});

const items = [
  item('running', 'a'),
  item('waiting_approval', 'b'),
  item('needs_review', 'c'),
  item('accepted', 'd'),
  item('failed', 'e'),
];

describe('Ruang Kerja: penyaringan run', () => {
  it('Berjalan memuat yang aktif dan menunggu izin, bukan yang menunggu tinjauan', () => {
    expect(filterRuns(items, 'active').map((i) => i.title)).toEqual(['a', 'b']);
    expect(filterRuns(items, 'review').map((i) => i.title)).toEqual(['c']);
    expect(filterRuns(items, 'done').map((i) => i.title)).toEqual(['d', 'e']);
    expect(filterRuns(items, 'all')).toHaveLength(5);
  });

  it('menghitung per kategori', () => {
    expect(countRuns(items)).toEqual({ all: 5, active: 2, review: 1, done: 2 });
  });

  it('hanya run yang belum final dan tidak menunggu tinjauan yang bisa dihentikan', () => {
    expect(isCancellable('running')).toBe(true);
    expect(isCancellable('waiting_approval')).toBe(true);
    expect(isCancellable('needs_review')).toBe(false);
    expect(isCancellable('completed')).toBe(false);
    expect(isLiveRun('needs_review')).toBe(true);
  });

  it('penanda status memakai token: bahaya, peringatan, aksen, sukses', () => {
    expect(statusDotClass('failed')).toBe('bg-danger');
    expect(statusDotClass('needs_review')).toBe('bg-warning');
    expect(statusDotClass('running')).toContain('bg-accent');
    expect(statusDotClass('accepted')).toBe('bg-success');
    expect(statusDotClass('cancelled')).toBe('bg-border-strong');
  });
});
