import { beforeEach, describe, expect, it } from 'vitest';
import { installBuildStamp, readBuildStamp } from './buildStamp';

describe('cap build e2e', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('tidak ada di build rilis: konstanta tidak ditanam, tidak ada atribut dan label', () => {
    const root = document.getElementById('root')!;
    expect(readBuildStamp()).toBeNull();
    installBuildStamp(root);
    expect(root.hasAttribute('data-build-commit')).toBe(false);
    expect(document.querySelector('[data-build-label]')).toBeNull();
  });

  it('menanam data-build-commit di root dan label tersembunyi dari pembaca layar', () => {
    const root = document.getElementById('root')!;
    installBuildStamp(root, { commit: 'abc1234', time: '2026-11-02T10:00:00Z', dirty: false });
    expect(root.getAttribute('data-build-commit')).toBe('abc1234');
    expect(root.getAttribute('data-build-dirty')).toBe('false');
    const label = document.querySelector('[data-build-label]');
    expect(label?.textContent).toBe('abc1234 2026-11-02T10:00:00Z');
    expect(label?.getAttribute('aria-hidden')).toBe('true');
  });

  it('menandai build dari working tree kotor dengan tanda bintang', () => {
    installBuildStamp(document.getElementById('root')!, {
      commit: 'abc1234',
      time: '',
      dirty: true,
    });
    expect(document.querySelector('[data-build-label]')?.textContent).toBe('abc1234*');
  });
});
