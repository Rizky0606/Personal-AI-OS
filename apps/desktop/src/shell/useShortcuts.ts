import { useEffect } from 'react';

export interface ShortcutActions {
  palette(): void;
  newChat(): void;
  toggleSidebar(): void;
  toggleRightPanel(): void;
  /** Ctrl+1..6: Chat, Project, Kanban, Jadwal, Riset, Pengaturan (urutan sidebar). */
  navigate(slot: number): void;
}

export const NAV_SLOTS = 6;

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
      return /^[1-6]$/.test(event.key) ? 'navigate' : null;
  }
}

/** Shortcut global: Ctrl+K palette, Ctrl+N chat baru, Ctrl+B sidebar, Ctrl+J panel kanan, Ctrl+1..6 pindah layar. */
export function useShortcuts(actions: ShortcutActions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutFor(event);
      if (!action) return;
      event.preventDefault();
      if (action === 'navigate') actions.navigate(Number(event.key));
      else actions[action]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}
