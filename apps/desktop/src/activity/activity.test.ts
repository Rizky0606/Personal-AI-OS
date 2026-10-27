import { describe, expect, it } from 'vitest';
import {
  currentStep,
  fileActivities,
  otherSteps,
  relativePath,
  toolKind,
  type ActivityStep,
} from './activity';

const step = (
  id: string,
  name: string,
  target: string | undefined,
  status: ActivityStep['status'] = 'ok',
): ActivityStep => ({ id, name, target, status });

describe('toolKind', () => {
  it('mengenali tool baca, ubah, cari, web, dan perintah; yang lain other', () => {
    expect(toolKind('read')).toBe('read');
    expect(toolKind('Edit')).toBe('edit');
    expect(toolKind('write')).toBe('edit');
    expect(toolKind('grep')).toBe('search');
    expect(toolKind('web_search')).toBe('web');
    expect(toolKind('cari_web')).toBe('web');
    expect(toolKind('baca_tautan')).toBe('web');
    expect(toolKind('bash')).toBe('command');
    expect(toolKind('mcp__aios-browser__screenshot')).toBe('other');
  });
});

describe('relativePath', () => {
  it('membuang awalan worktree, ./, dan nomor baris; menolak path di luar worktree', () => {
    expect(relativePath('C:\\data\\worker\\worktrees\\run-1\\src\\App.tsx')).toBe('src/App.tsx');
    expect(relativePath('/home/u/.local/worktrees/abc/src/a.ts')).toBe('src/a.ts');
    expect(relativePath('./src/a.ts')).toBe('src/a.ts');
    expect(relativePath('src/a.ts:12-30')).toBe('src/a.ts');
    expect(relativePath('/etc/passwd')).toBeNull();
    expect(relativePath('../luar.ts')).toBeNull();
    expect(relativePath(undefined)).toBeNull();
    expect(relativePath('baris satu\nbaris dua')).toBeNull();
  });
});

describe('fileActivities', () => {
  it('menggabungkan berkas yang sama; ubah mengalahkan baca; yang terakhir disentuh di atas', () => {
    const list = fileActivities([
      step('1', 'read', 'src/a.ts'),
      step('2', 'read', 'src/b.ts'),
      step('3', 'edit', 'src/a.ts'),
      step('4', 'read', 'src/a.ts', 'running'),
    ]);
    expect(list.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(list[0]).toMatchObject({ action: 'edit', running: true, count: 3 });
    expect(list[1]).toMatchObject({ action: 'read', running: false, count: 1 });
  });

  it('mengabaikan pencarian, perintah, dan path yang tidak bisa direlatifkan', () => {
    expect(
      fileActivities([
        step('1', 'grep', 'TODO'),
        step('2', 'bash', 'pnpm test'),
        step('3', 'read', '/etc/hosts'),
      ]),
    ).toEqual([]);
  });
});

describe('currentStep dan otherSteps', () => {
  const steps = [
    step('1', 'read', 'a.ts'),
    step('2', 'grep', 'fitur', 'ok'),
    step('3', 'bash', 'pnpm test', 'running'),
  ];

  it('langkah yang berjalan terakhir', () => {
    expect(currentStep(steps)?.id).toBe('3');
    expect(currentStep(steps.slice(0, 2))).toBeUndefined();
  });

  it('langkah non-berkas, terbaru di atas, dibatasi', () => {
    expect(otherSteps(steps).map((s) => s.id)).toEqual(['3', '2']);
    expect(otherSteps(steps, 1).map((s) => s.id)).toEqual(['3']);
  });
});
