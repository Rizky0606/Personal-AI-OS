import type { MessageInput } from '../api/gateway';
import { copy } from '../copy';
import { isSettled, type LiveRun } from '../realtime/liveRun';
import {
  QUICK_SHORTCUT,
  QuickEvent,
  type QuickAsk,
  type QuickOpen,
  type QuickUpdate,
} from './protocol';

/** Operasi multi-jendela Tauri yang dipakai jembatan; dipisah supaya logikanya bisa dites tanpa Tauri. */
export interface QuickHost {
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  emitToQuick(event: string, payload: unknown): Promise<void>;
  /** Mendaftarkan hotkey global; mengembalikan fungsi pelepas. Melempar bila kombinasi dipakai aplikasi lain. */
  registerShortcut(shortcut: string, onPress: () => void): Promise<() => void>;
  toggleQuick(): Promise<void>;
  hideQuick(): Promise<void>;
  showMain(): Promise<void>;
}

export interface QuickBridgeDeps {
  host: QuickHost;
  api: {
    createConversation(): Promise<{ id: string }>;
    sendMessage(conversationId: string, input: MessageInput): Promise<{ run: { id: string } }>;
  };
  runs: {
    track(runId: string): void;
    get(runId: string): LiveRun | undefined;
    subscribe(runId: string, listener: () => void): () => void;
  };
  openConversation(conversationId: string): void;
  errorMessage(error: unknown): string;
  log?: (message: string, error: unknown) => void;
}

/**
 * Sisi jendela utama: menerima pertanyaan dari jendela Quick Ask, membuat percakapan baru, dan meneruskan jawaban
 * yang mengalir. Mengembalikan fungsi penghenti (melepas hotkey dan pendengar).
 */
export async function startQuickBridge(deps: QuickBridgeDeps): Promise<() => void> {
  const { host, api, runs } = deps;
  const stops: (() => void)[] = [];
  const send = (update: QuickUpdate) =>
    host.emitToQuick(QuickEvent.update, update).catch((e: unknown) => deps.log?.('emit', e));

  async function ask({ id, text }: QuickAsk) {
    const question = text.trim();
    if (!question) return;
    let conversationId: string | null = null;
    try {
      await send({ id, status: 'sending', conversationId, text: '' });
      conversationId = (await api.createConversation()).id;
      const { run } = await api.sendMessage(conversationId, { text: question });
      runs.track(run.id);
      const forward = () => {
        const live = runs.get(run.id);
        if (!live) return; // Sudah dilepas setelah selesai; pembaruan terakhir sudah terkirim.
        const settled = isSettled(live.status);
        const failed = settled && (live.status !== 'completed' || live.error !== null);
        void send({
          id,
          conversationId,
          text: live.text,
          status: !settled ? 'streaming' : failed ? 'error' : 'done',
          ...(failed ? { error: live.error?.message ?? copy.quick.failed } : {}),
        });
        if (settled) unsubscribe();
      };
      const unsubscribe = runs.subscribe(run.id, forward);
      forward();
    } catch (error) {
      await send({
        id,
        status: 'error',
        conversationId,
        text: '',
        error: deps.errorMessage(error),
      });
    }
  }

  try {
    stops.push(await host.listen<QuickAsk>(QuickEvent.ask, (payload) => void ask(payload)));
    stops.push(
      await host.listen<QuickOpen>(QuickEvent.open, ({ conversationId }) => {
        deps.openConversation(conversationId);
        void host.showMain();
        void host.hideQuick();
      }),
    );
    stops.push(await host.registerShortcut(QUICK_SHORTCUT, () => void host.toggleQuick()));
  } catch (error) {
    // Hotkey dipakai aplikasi lain atau izin hilang: aplikasi utama tetap jalan tanpa Quick Ask.
    deps.log?.('Quick Ask tidak aktif', error);
  }
  return () => stops.forEach((stop) => stop());
}
