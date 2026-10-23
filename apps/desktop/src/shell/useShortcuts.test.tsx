import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { shortcutFor, useShortcuts, type ShortcutActions } from './useShortcuts';

const key = (k: string, over: Partial<KeyboardEvent> = {}) => ({
  key: k,
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe('shortcutFor', () => {
  it('Ctrl+K/N/B/J dipetakan ke aksi', () => {
    expect(shortcutFor(key('k'))).toBe('palette');
    expect(shortcutFor(key('N'))).toBe('newChat');
    expect(shortcutFor(key('b'))).toBe('toggleSidebar');
    expect(shortcutFor(key('j'))).toBe('toggleRightPanel');
  });

  it('Ctrl+1..6 berpindah layar; 0 dan 7 bukan shortcut', () => {
    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      expect(shortcutFor(key(digit))).toBe('navigate');
    }
    expect(shortcutFor(key('0'))).toBeNull();
    expect(shortcutFor(key('7'))).toBeNull();
  });

  it('tanpa Ctrl, dengan Alt/Shift, atau tombol lain diabaikan', () => {
    expect(shortcutFor(key('k', { ctrlKey: false }))).toBeNull();
    expect(shortcutFor(key('k', { altKey: true }))).toBeNull();
    expect(shortcutFor(key('k', { shiftKey: true }))).toBeNull();
    expect(shortcutFor(key('x'))).toBeNull();
  });
});

function Harness({ actions }: { actions: ShortcutActions }) {
  useShortcuts(actions);
  return null;
}

describe('useShortcuts', () => {
  const make = () => ({
    palette: vi.fn(),
    newChat: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleRightPanel: vi.fn(),
    navigate: vi.fn(),
  });

  it('memanggil aksi yang tepat dan mencegah perilaku bawaan peramban (Ctrl+N, Ctrl+K)', () => {
    const actions = make();
    render(<Harness actions={actions} />);

    const notPrevented = fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });

    expect(notPrevented).toBe(false);
    expect(actions.newChat).toHaveBeenCalledTimes(1);
    expect(actions.palette).toHaveBeenCalledTimes(1);
    expect(actions.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(actions.toggleRightPanel).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+angka memanggil navigate dengan nomor slotnya', () => {
    const actions = make();
    render(<Harness actions={actions} />);

    fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    fireEvent.keyDown(window, { key: '6', ctrlKey: true });

    expect(actions.navigate.mock.calls).toEqual([[3], [6]]);
  });

  it('tombol biasa tidak memicu apa pun; pendengar dilepas saat unmount', () => {
    const actions = make();
    const { unmount } = render(<Harness actions={actions} />);

    expect(fireEvent.keyDown(window, { key: 'k' })).toBe(true);
    unmount();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(actions.palette).not.toHaveBeenCalled();
  });
});
