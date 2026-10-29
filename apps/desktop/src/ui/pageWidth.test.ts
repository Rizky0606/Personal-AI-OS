import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Lebar isi layar non-chat hanya boleh datang dari `<PageContainer>` (token `--aios-page-measure`).
 * Tes statis ini menggagalkan max-w buatan sendiri di layar supaya lebar halaman tidak menyimpang lagi.
 */
const SRC = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
);
const EXEMPT_DIRS: Record<string, true> = {
  chat: true,
  kanban: true,
  projects: true,
  workspace: true,
  shell: true,
  ui: true,
  fonts: true,
};
const WRAPPER = /max-w-(?:xl|2xl|3xl|4xl)\b|max-w-\[calc\(72ch/;

function files(dir: string, top: boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return top && EXEMPT_DIRS[name] ? [] : files(full, false);
    return name.endsWith('.tsx') && !name.endsWith('.test.tsx') ? [full] : [];
  });
}

function offenders(text: string): string[] {
  return text.split('\n').flatMap((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (/^\s*\*/.test(line)) return [];
    return WRAPPER.test(code) ? [`${i + 1}: ${line.trim().slice(0, 100)}`] : [];
  });
}

describe('lebar halaman', () => {
  it('mendeteksi pembungkus lebar buatan sendiri', () => {
    expect(offenders('<div className="flex max-w-2xl flex-col">')).toHaveLength(1);
    expect(offenders('<div className="mx-auto max-w-[calc(72ch+4rem)] px-8">')).toHaveLength(1);
    expect(offenders('<p className="max-w-[72ch]">')).toHaveLength(0);
    expect(offenders('<div className="max-w-(--aios-page-measure)">')).toHaveLength(0);
  });

  it('tidak ada layar di luar chat, kanban, projects, workspace, shell, dan ui yang memakai max-w halaman sendiri', () => {
    const found = files(SRC, true).flatMap((file) =>
      offenders(readFileSync(file, 'utf8')).map(
        (hit) => `${path.relative(SRC, file).replaceAll('\\', '/')}:${hit}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
