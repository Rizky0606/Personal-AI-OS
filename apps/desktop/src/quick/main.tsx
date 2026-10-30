import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyReduceMotion, applyTheme, useUiStore } from '../state/uiStore';
import { TooltipProvider } from '../ui/Tooltip';
import {
  MAIN_LABEL,
  QuickEvent,
  type QuickAsk,
  type QuickOpen,
  type QuickUpdate,
} from './protocol';
import { QuickApp, type QuickChannel } from './QuickApp';
import '../styles.css';

/*
 * Entri jendela Quick Ask (quick.html). Sengaja tidak mengimpor app/services: jendela ini tidak punya sesi atau
 * koneksi realtime sendiri, semuanya lewat jendela utama.
 */

/** Pendengar event Tauri yang dipasang sinkron dan dilepas setelah pendaftaran async selesai. */
function on<T>(event: string, handler: (payload: T) => void): () => void {
  let stop: (() => void) | undefined;
  let cancelled = false;
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<T>(event, (e) => handler(e.payload)).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    }),
  );
  return () => {
    cancelled = true;
    stop?.();
  };
}

const emitToMain = (event: string, payload: unknown) =>
  void import('@tauri-apps/api/event').then(({ emitTo }) => emitTo(MAIN_LABEL, event, payload));

const channel: QuickChannel = {
  ask: (id, text) => emitToMain(QuickEvent.ask, { id, text } satisfies QuickAsk),
  open: (conversationId) => emitToMain(QuickEvent.open, { conversationId } satisfies QuickOpen),
  hide: () =>
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().hide()),
  onUpdate: (handler) => on<QuickUpdate>(QuickEvent.update, handler),
  onShown: (handler) =>
    on<null>(QuickEvent.shown, () => {
      // Tema bisa diganti di jendela utama sejak jendela ini terakhir tampil.
      void useUiStore.persist.rehydrate();
      handler();
    }),
};

useUiStore.subscribe((state) => {
  applyTheme(state.theme);
  applyReduceMotion(state.reduceMotion);
});
applyTheme(useUiStore.getState().theme);
applyReduceMotion(useUiStore.getState().reduceMotion);

const root = document.getElementById('root');
if (!root) throw new Error('Elemen #root tidak ada di quick.html.');
createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={400}>
      <QuickApp channel={channel} />
    </TooltipProvider>
  </StrictMode>,
);
