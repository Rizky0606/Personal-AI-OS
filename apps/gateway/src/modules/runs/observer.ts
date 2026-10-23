/**
 * Pengamat perubahan run. Runner dan layanan tinjauan memberi tahu "run ini berubah" tanpa tahu siapa
 * yang peduli (kartu kanban); pendengar dipasang belakangan karena layanan kartu butuh chat, yang butuh runner.
 */
export interface RunObserver {
  /** Tidak pernah melempar dan tidak ditunggu: kegagalan pendengar tidak boleh menggagalkan run. */
  notify(runId: string): void;
  /** Memasang pendengar (sekali). */
  bind(listener: (runId: string) => Promise<void> | void): void;
}

export function createRunObserver(log?: {
  error: (obj: object, msg: string) => void;
}): RunObserver {
  let listener: ((runId: string) => Promise<void> | void) | undefined;
  return {
    notify(runId) {
      if (!listener) return;
      try {
        void Promise.resolve(listener(runId)).catch((err: unknown) =>
          log?.error({ err, runId }, 'pendengar perubahan run gagal'),
        );
      } catch (err) {
        log?.error({ err, runId }, 'pendengar perubahan run gagal');
      }
    },
    bind(next) {
      listener = next;
    },
  };
}
