import { useEffect } from 'react';

export interface ShortcutActions {
  palette(): void;
  newChat(): void;
  toggleSidebar(): void;
  toggleRightPanel(): void;
}

/** Peta tombol ke aksi; null bila bukan shortcut aplikasi. Murni, agar mudah dites. */
export function shortcutFor(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): keyof ShortcutActions | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  switch (event.key.toLowerCase()) {
    case 'k':
      return 'palette';
    case 'n':
      return 'newChat';
    case 'b':
      return 'toggleSidebar';
    case 'j':
      return 'toggleRightPanel';
    default:
      return null;
  }
}

/** Shortcut global: Ctrl+K palette, Ctrl+N chat baru, Ctrl+B sidebar, Ctrl+J panel kanan. */
export function useShortcuts(actions: ShortcutActions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      actions[action]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}
