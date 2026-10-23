import type { AgentEvent } from '@aios/contracts';

/** Antarmuka adapter persis seperti ARCHITECTURE.md ("Agent Adapter"). UI tidak pernah tahu mesin mana yang berjalan. */

export interface AdapterCapabilities {
  streaming: boolean;
  approvals: boolean;
  steer: boolean;
  checkpoints: boolean;
}

export interface StartRunInput {
  runId: string;
  /** ID pesan asisten yang diisi `message.delta`. Dibuat gateway sebelum run dimulai. */
  messageId: string;
  prompt: string;
  /** Role dan skill, disuntik sebagai pesan sistem. */
  systemPrompt?: string | undefined;
  model?: string | undefined;
  /** ID sesi di mesin agar percakapan berlanjut; gateway menyimpannya per percakapan. */
  sessionId?: string | undefined;
  /** Pembatalan dari luar (selain `RunHandle.cancel`). */
  signal?: AbortSignal | undefined;
}

export interface RunHandle {
  readonly runId: string;
  /**
   * Event ternormalisasi (API_CONTRACT.md). Hanya bisa dibaca sekali. Berakhir setelah `run.completed`
   * (sukses), setelah `error` (gagal), atau tanpa event penutup bila dibatalkan lewat `cancel`.
   */
  events: AsyncIterable<AgentEvent>;
  steer(text: string): Promise<void>;
  cancel(): Promise<void>;
  resolveApproval(id: string, decision: 'allow' | 'deny', remember?: boolean): Promise<void>;
}

export interface AgentAdapter {
  readonly id: 'hermes' | 'omp' | 'pi';
  capabilities(): AdapterCapabilities;
  startRun(input: StartRunInput): Promise<RunHandle>;
}

/** Kegagalan adapter dengan kode stabil; dipetakan ke event `error` oleh `errorEvent`. */
export class AdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}
