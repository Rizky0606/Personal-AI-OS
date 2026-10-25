import { useEffect } from 'react';
import { apiErrorMessage } from '../api/errors';
import { currentWindowLabel } from '../lib/tauri';
import { startQuickBridge } from '../quick/bridge';
import { MAIN_LABEL } from '../quick/protocol';
import { createTauriQuickHost } from '../quick/tauriHost';
import { router } from './router';
import { api, runs } from './services';

/**
 * Jembatan Quick Ask (W20) selama pemilik masuk, hanya di jendela utama aplikasi Tauri (bukan peramban `vite dev`
 * atau E2E, yang tidak punya jendela kedua maupun hotkey global).
 */
export function QuickAskLifecycle() {
  useEffect(() => {
    if (currentWindowLabel() !== MAIN_LABEL) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void startQuickBridge({
      host: createTauriQuickHost(),
      api: {
        createConversation: () => api.createConversation('windows'),
        sendMessage: api.sendMessage,
      },
      runs,
      openConversation: (conversationId) =>
        void router.navigate({ to: '/chat/$conversationId', params: { conversationId } }),
      errorMessage: (error) => apiErrorMessage(error, navigator.onLine),
      log: (message, error) => console.warn(message, error),
    }).then((s) => {
      if (cancelled) s();
      else stop = s;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return null;
}
