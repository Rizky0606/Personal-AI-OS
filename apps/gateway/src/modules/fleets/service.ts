import {
  MAX_FLEET_TASKS,
  TERMINAL_RUN_STATUSES,
  type FleetRequestSchema,
  type FleetResponseSchema,
} from '@aios/contracts';
import { count, eq, and, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { conversations, projects, runs } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import type { ChatService } from '../chat/service.js';

export type FleetRequest = z.infer<typeof FleetRequestSchema>;
export type FleetResponse = z.infer<typeof FleetResponseSchema>;

export interface FleetService {
  /** Memulai tiap tugas sebagai percakapan dan run coding sendiri; kembali setelah semuanya dimulai. */
  launch(input: FleetRequest): Promise<FleetResponse>;
}

const MAX_TITLE_CHARS = 60;

const titleOf = (prompt: string): string => {
  const line = (prompt.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
  return line.length > MAX_TITLE_CHARS ? `${line.slice(0, MAX_TITLE_CHARS - 1)}…` : line;
};

/**
 * Armada agent (W35): beberapa tugas berbeda berjalan paralel di satu project. Tiap tugas adalah percakapan
 * sendiri (jadi bisa dibuka, diarahkan, dan ditinjau sendiri-sendiri) dan run coding sendiri di worktree sendiri,
 * sehingga hasilnya tidak saling menimpa. Jumlah agent yang berjalan bersamaan di satu project dibatasi
 * (`MAX_FLEET_TASKS`), dihitung dari semua run yang belum selesai, termasuk dari kartu kanban dan chat biasa.
 */
export function createFleetService(deps: {
  db: Database;
  chat: Pick<ChatService, 'createConversation' | 'sendMessage'>;
  maxLive?: number;
}): FleetService {
  const { db, chat, maxLive = MAX_FLEET_TASKS } = deps;

  async function liveRuns(projectId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(runs)
      .innerJoin(conversations, eq(runs.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.projectId, projectId),
          // Menunggu tinjauan tidak memakai CPU; hanya yang masih berjalan atau menunggu izin.
          notInArray(runs.status, [...TERMINAL_RUN_STATUSES, 'needs_review']),
        ),
      );
    return row?.n ?? 0;
  }

  return {
    async launch(input) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, input.projectId));
      if (!project) throw new AppError(404, 'project_not_found', 'Project tidak ditemukan.');

      const live = await liveRuns(input.projectId);
      if (live + input.tasks.length > maxLive) {
        throw new AppError(
          409,
          'fleet_busy',
          live === 0
            ? `Satu armada paling banyak ${maxLive} agent.`
            : `Project ini sudah punya ${live} agent yang berjalan; batasnya ${maxLive} sekaligus. Tunggu ada yang selesai atau hentikan dulu.`,
        );
      }

      const items: FleetResponse['items'] = [];
      let failed = 0;
      for (const task of input.tasks) {
        try {
          const title = titleOf(task.prompt);
          const conversation = await chat.createConversation({
            surface: 'windows',
            projectId: input.projectId,
            title,
          });
          const { run } = await chat.sendMessage(conversation.id, {
            parts: [{ type: 'text', text: task.prompt }],
            ...(input.planOnly ? { planOnly: true } : {}),
            ...(input.model ? { model: input.model } : {}),
          });
          items.push({ conversationId: conversation.id, title, run });
        } catch (error) {
          // Satu tugas gagal dimulai tidak membatalkan yang sudah berjalan; yang pertama gagal dilaporkan apa adanya.
          if (items.length === 0 && failed === 0 && input.tasks.length === 1) throw error;
          failed += 1;
        }
      }
      if (items.length === 0) {
        throw new AppError(502, 'fleet_failed', 'Tidak ada agent yang berhasil dimulai.');
      }
      return { items, failed };
    },
  };
}
