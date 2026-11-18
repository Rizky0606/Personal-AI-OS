import { CONNECTORS_PER_RUN_MAX, type AgentEvent, type WorkerCommand } from '@aios/contracts';
import { AsyncQueue } from './queue.js';
import {
  AdapterError,
  type AdapterCapabilities,
  type AgentAdapter,
  type RunHandle,
  type StartRunInput,
} from './types.js';

/** Konektor MCP yang ikut ke satu run; tanpa URL dan tanpa token (DESIGN_MCP_KONEKTOR.md #3). */
export interface RunConnector {
  id: string;
  name: string;
  displayName: string;
}

/** Sisi gateway dari koneksi ke worker. Diimplementasikan gateway; adapter hanya memakainya. */
export interface WorkerRelayPort {
  /** Mengirim perintah ke worker pemilik project. Melempar AdapterError bila tidak ada atau tidak tersambung. */
  send(projectId: string, command: WorkerCommand): Promise<void>;
  /**
   * Mendengarkan event satu run dari worker pemilik project. `onDisconnect`/`onReconnect` dipanggil saat
   * koneksi worker itu putus atau pulih. Mengembalikan fungsi berhenti.
   */
  listen(
    runId: string,
    projectId: string,
    handlers: {
      onEvent: (event: AgentEvent) => void;
      onDisconnect: () => void;
      onReconnect: () => void;
    },
  ): Promise<() => void>;
}

export interface WorkerRelayOptions {
  relay: WorkerRelayPort;
  /** Berapa lama koneksi worker boleh putus sebelum run dianggap gagal (worker menahan event dan menyusulkannya). */
  disconnectGraceMs?: number;
  /** Menunggu worker mengonfirmasi pembatalan sebelum aliran ditutup paksa. */
  cancelGraceMs?: number;
  /** Gateway menyajikan tool `aios_tools` (POST /v1/mcp): `run.start` membawa `gatewayTools: true`. */
  gatewayTools?: boolean;
  /**
   * Konektor MCP yang aktif saat run dimulai (DESIGN_MCP_KONEKTOR.md #3). Dibaca per run, bukan sekali saat
   * adapter dibuat, karena pemilik bisa menyalakan/mematikan konektor di antara dua run. Hanya `{id, name,
   * displayName}` yang ikut: URL dan token konektor tidak pernah meninggalkan gateway.
   */
  connectors?: () => Promise<readonly RunConnector[]>;
}

const CAPABILITIES: AdapterCapabilities = {
  streaming: true,
  approvals: true,
  steer: true,
  checkpoints: false,
};

/**
 * Adapter run coding di PC Windows: meneruskan `run.start` ke worker lewat WebSocket dan mengalirkan
 * event-nya kembali (ARCHITECTURE.md, "Alur utama: run coding"). Mesinnya (omp) berjalan di worker lewat
 * adapter omp; di sisi gateway ini hanya relay. Gateway memegang status run, jadi `run.status` dari worker
 * tidak diteruskan, kecuali sebagai penutup (`cancelled`/`failed`).
 */
export function createWorkerRelayAdapter(options: WorkerRelayOptions): AgentAdapter {
  const disconnectGrace = options.disconnectGraceMs ?? 60_000;
  const cancelGrace = options.cancelGraceMs ?? 10_000;

  /** Daftar konektor run ini; kegagalan membacanya tidak boleh menggagalkan run coding. */
  const connectorsFor = async (): Promise<RunConnector[]> => {
    if (!options.connectors) return [];
    try {
      return (await options.connectors()).slice(0, CONNECTORS_PER_RUN_MAX);
    } catch {
      return [];
    }
  };

  return {
    id: 'omp',
    capabilities: () => CAPABILITIES,

    async startRun(input: StartRunInput): Promise<RunHandle> {
      const { projectId } = input;
      if (!projectId) {
        throw new AdapterError('project_required', 'Run coding membutuhkan project.');
      }
      const queue = new AsyncQueue<AgentEvent>();
      let ended = false;
      let cancelRequested = false;
      let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let cancelTimer: ReturnType<typeof setTimeout> | undefined;
      let stop: () => void = () => undefined;

      const end = () => {
        if (ended) return;
        ended = true;
        clearTimeout(disconnectTimer);
        clearTimeout(cancelTimer);
        stop();
        queue.end();
      };
      const push = (event: AgentEvent) => {
        if (!ended) queue.push(event);
      };

      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case 'run.status':
            // Gateway pemilik status; hanya penutup dari worker yang berarti.
            if (event.status === 'cancelled') end();
            else if (event.status === 'failed') {
              push({
                type: 'error',
                code: 'run_failed',
                message: 'Worker melaporkan run gagal.',
                retryable: false,
              });
              end();
            }
            return;
          case 'message.delta':
          case 'reasoning.delta':
          case 'reasoning.summary':
          case 'message.completed':
            // ID pesan asisten dibuat gateway; worker tidak mengenalnya.
            push({ ...event, messageId: input.messageId });
            return;
          case 'run.completed':
          case 'error':
            push(event);
            end();
            return;
          default:
            push(event);
        }
      };

      stop = await options.relay.listen(input.runId, projectId, {
        onEvent,
        onDisconnect: () => {
          clearTimeout(disconnectTimer);
          disconnectTimer = setTimeout(() => {
            push({
              type: 'error',
              code: 'worker_disconnected',
              message:
                'Koneksi ke worker terputus terlalu lama. Buka aplikasi desktop lalu jalankan ulang.',
              retryable: true,
            });
            end();
          }, disconnectGrace);
        },
        onReconnect: () => clearTimeout(disconnectTimer),
      });

      const connectors = await connectorsFor();
      try {
        await options.relay.send(projectId, {
          type: 'run.start',
          runId: input.runId,
          projectId,
          prompt: input.prompt,
          bundle: {
            role: input.role ?? 'general',
            systemPrompt: input.systemPrompt ?? '',
            skillIds: [...(input.skillIds ?? [])],
          },
          model: input.model ?? 'default',
          ...(input.continueFromRunId ? { continueFromRunId: input.continueFromRunId } : {}),
          ...(input.workspace ? { workspace: input.workspace } : {}),
          ...(input.planOnly ? { planOnly: true } : {}),
          ...(input.history?.length ? { history: [...input.history] } : {}),
          ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
          ...(options.gatewayTools ? { gatewayTools: true } : {}),
          ...(connectors.length > 0 ? { connectors } : {}),
        });
      } catch (error) {
        stop();
        throw error;
      }
      input.signal?.addEventListener('abort', () => void handle.cancel(), { once: true });

      const handle: RunHandle = {
        runId: input.runId,
        events: queue,
        async removeQueued(queue, text) {
          if (ended) throw new AdapterError('run_finished', 'Run sudah selesai.');
          await options.relay.send(projectId, {
            type: 'queue.remove',
            runId: input.runId,
            queue,
            text,
          });
        },
        async steer(text, mode) {
          if (ended) throw new AdapterError('run_finished', 'Run sudah selesai.');
          await options.relay.send(projectId, {
            type: 'run.steer',
            runId: input.runId,
            text,
            ...(mode === 'followUp' ? { mode } : {}),
          });
        },
        async cancel() {
          if (ended || cancelRequested) return;
          cancelRequested = true;
          // Worker mengonfirmasi dengan run.status cancelled; bila tidak datang, aliran ditutup paksa.
          cancelTimer = setTimeout(end, cancelGrace);
          await options.relay
            .send(projectId, { type: 'run.cancel', runId: input.runId })
            .catch(end);
        },
        async resolveApproval(id, decision, remember = false, forRun = false) {
          if (ended) throw new AdapterError('run_finished', 'Run sudah selesai.');
          await options.relay.send(projectId, {
            type: 'approval.resolve',
            runId: input.runId,
            approvalId: id,
            decision,
            remember,
            ...(forRun ? { forRun: true } : {}),
          });
        },
        async answerQuestion(questionId, { answers, cancelled }) {
          if (ended) throw new AdapterError('run_finished', 'Run sudah selesai.');
          await options.relay.send(projectId, {
            type: 'question.answer',
            runId: input.runId,
            questionId,
            answers,
            cancelled,
          });
        },
      };
      return handle;
    },
  };
}
