import type { QuickHost } from './bridge';
import { MAIN_LABEL, QUICK_LABEL, QuickEvent } from './protocol';

async function windowOf(label: string) {
  const { Window } = await import('@tauri-apps/api/window');
  return Window.getByLabel(label);
}

async function reveal(label: string) {
  const win = await windowOf(label);
  if (!win) return;
  await win.show();
  await win.unminimize();
  await win.setFocus();
}

/** Host Quick Ask di jendela utama: hotkey global, tampil/sembunyi jendela, dan event antarjendela. */
export function createTauriQuickHost(): QuickHost {
  return {
    async listen(event, handler) {
      const { listen } = await import('@tauri-apps/api/event');
      return listen(event, (e) => handler(e.payload as never));
    },

    async emitToQuick(event, payload) {
      const { emitTo } = await import('@tauri-apps/api/event');
      await emitTo(QUICK_LABEL, event, payload);
    },

    async registerShortcut(shortcut, onPress) {
      const shortcuts = await import('@tauri-apps/plugin-global-shortcut');
      // Muat ulang jendela (dev) atau efek ganda: lepas pendaftaran lama milik aplikasi ini dulu.
      if (await shortcuts.isRegistered(shortcut)) await shortcuts.unregister(shortcut);
      await shortcuts.register(shortcut, (event) => {
        if (event.state === 'Pressed') onPress();
      });
      return () => void shortcuts.unregister(shortcut);
    },

    async toggleQuick() {
      const win = await windowOf(QUICK_LABEL);
      if (!win) return;
      if ((await win.isVisible()) && (await win.isFocused())) {
        await win.hide();
        return;
      }
      await reveal(QUICK_LABEL);
      const { emitTo } = await import('@tauri-apps/api/event');
      await emitTo(QUICK_LABEL, QuickEvent.shown, null);
    },

    async hideQuick() {
      await (await windowOf(QUICK_LABEL))?.hide();
    },

    showMain: () => reveal(MAIN_LABEL),
  };
}
