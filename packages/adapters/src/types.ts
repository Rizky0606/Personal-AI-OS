import type { AgentEvent, QueueName, QuestionAnswer, SteerMode } from '@aios/contracts';

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
  /**
   * Riwayat sebelum `prompt`, kronologis. Hanya diisi pada giliran pertama sesi baru (setelah percakapan
   * dipotong lewat edit/hapus pesan), karena sesi lama di mesin masih memuat bagian yang dibuang.
   */
  history?: readonly { role: 'user' | 'assistant'; content: string }[] | undefined;
  /** Gambar lampiran pesan ini (base64). Hanya Hermes; omp mengabaikannya. */
  images?: readonly { mime: string; data: string }[] | undefined;
  /** Pembatalan dari luar (selain `RunHandle.cancel`). */
  signal?: AbortSignal | undefined;
  /** Project yang dikerjakan (run coding lewat worker). */
  projectId?: string | undefined;
  /** Role yang dipilih router; worker memakainya untuk memberi nama run. */
  role?: string | undefined;
  /** Run lanjutan: memakai worktree run ini (revisi setelah komentar review). Hanya omp via worker. */
  continueFromRunId?: string | undefined;
  /** Mode rencana: worker menolak semua permintaan izin. Hanya omp via worker. */
  planOnly?: boolean | undefined;
  /** Folder kerja agent (worktree). Hanya omp; wajib di sana. */
  cwd?: string | undefined;
  /** Folder berkas pendukung run di luar worktree (konfigurasi provider, system prompt). Hanya omp. */
  runDir?: string | undefined;
  /** Server MCP (HTTP) yang disediakan worker untuk run ini, mis. tool browser. Hanya omp. */
  mcpServers?: Record<string, { url: string; headers?: Record<string, string> }> | undefined;
  /** Menyalakan LSP omp (diagnostik setelah edit, definisi, referensi). Hanya omp; bawaan mati. */
  lsp?: boolean | undefined;
}

export interface RunHandle {
  readonly runId: string;
  /**
   * Event ternormalisasi (API_CONTRACT.md). Hanya bisa dibaca sekali. Berakhir setelah `run.completed`
   * (sukses), setelah `error` (gagal), atau tanpa event penutup bila dibatalkan lewat `cancel`.
   */
  events: AsyncIterable<AgentEvent>;
  /** `followUp` mengantre teks sampai giliran agent selesai; bawaan `steer` menyisipkannya setelah tool berjalan. */
  steer(text: string, mode?: SteerMode): Promise<void>;
  /** Menarik arahan dari antrean agent sebelum diproses (`text` persis seperti di `queue.updated`). */
  removeQueued(queue: QueueName, text: string): Promise<void>;
  cancel(): Promise<void>;
  resolveApproval(id: string, decision: 'allow' | 'deny', remember?: boolean): Promise<void>;
  /** Menjawab pertanyaan agent (`question.asked`); `cancelled` membuat agent memakai pilihan yang direkomendasikan. */
  answerQuestion(
    questionId: string,
    result: { answers: QuestionAnswer[]; cancelled: boolean },
  ): Promise<void>;
}

export interface AgentAdapter {
  readonly id: 'hermes' | 'omp' | 'pi' | 'dsh';
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
