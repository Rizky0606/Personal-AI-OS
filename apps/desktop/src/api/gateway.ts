import type { ModelInfoSchema, RoleInfoSchema } from '@aios/contracts';
import {
  ApprovalSchema,
  ConversationSchema,
  IdSchema,
  LoginResponseSchema,
  MessageSchema,
  ModelListSchema,
  ProjectSchema,
  ResearchJobDetailSchema,
  ResearchJobSchema,
  RerouteResponseSchema,
  RoleListSchema,
  RunSchema,
  ScheduleParseResponseSchema,
  ScheduleRunSchema,
  ScheduleSchema,
  SendMessageResponseSchema,
  type CreateProjectRequestSchema,
  type CreateScheduleRequestSchema,
  type ResearchDepth,
  type Surface,
} from '@aios/contracts';
import { z } from 'zod';

/** Fungsi pemanggil REST (sudah berisi auth dan refresh token); di aplikasi: `auth.authedFetch`. */
export type Call = (
  path: string,
  init?: { method?: string; body?: unknown; raw?: boolean },
) => Promise<unknown>;

export class ResponseShapeError extends Error {
  constructor(path: string) {
    super(`Respons ${path} tidak sesuai kontrak.`);
    this.name = 'ResponseShapeError';
  }
}

const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextBefore: IdSchema.nullable() });
const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

const ConversationPageSchema = page(ConversationSchema);
const MessagePageSchema = page(MessageSchema);
const ScheduleRunPageSchema = page(ScheduleRunSchema);
const ResearchPageSchema = page(ResearchJobSchema);
const ScheduleListSchema = items(ScheduleSchema);
const ProjectListSchema = items(ProjectSchema);

export type RoleInfo = z.infer<typeof RoleInfoSchema>;
export type Approval = z.infer<typeof ApprovalSchema>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type ConversationPage = z.infer<typeof ConversationPageSchema>;
export type MessagePage = z.infer<typeof MessagePageSchema>;
export type ScheduleRunPage = z.infer<typeof ScheduleRunPageSchema>;
export type ResearchPage = z.infer<typeof ResearchPageSchema>;
export type ResearchJobDetail = z.infer<typeof ResearchJobDetailSchema>;
export type ScheduleParse = z.infer<typeof ScheduleParseResponseSchema>;
export type CreateScheduleInput = z.input<typeof CreateScheduleRequestSchema>;
export type CreateProjectInput = z.input<typeof CreateProjectRequestSchema>;
export type WorkerRegistration = z.infer<typeof LoginResponseSchema>;

export const PAGE_SIZE = 50;

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/**
 * Semua endpoint yang dipakai desktop untuk fitur non-coding. Respons divalidasi dengan skema dari
 * `@aios/contracts`: bentuk yang melenceng gagal keras (ResponseShapeError), bukan diam-diam rusak di UI.
 */
export function createGatewayApi(call: Call) {
  async function get<T extends z.ZodType>(path: string, schema: T, init?: Parameters<Call>[1]) {
    const result = schema.safeParse(await call(path, init));
    if (!result.success) throw new ResponseShapeError(path);
    return result.data;
  }

  return {
    registerWorker: (name: string) =>
      get('/devices/worker', LoginResponseSchema, { method: 'POST', body: { name } }),
    listProjects: async () => (await get('/projects', ProjectListSchema)).items,
    createProject: (input: CreateProjectInput) =>
      get('/projects', ProjectSchema, { method: 'POST', body: input }),

    listModels: async () => (await get('/models', ModelListSchema)).items,
    listRoles: async () => (await get('/roles', RoleListSchema)).items,

    listConversations: (before?: string, projectId?: string) =>
      get(
        `/conversations${query({ before, limit: PAGE_SIZE, projectId })}`,
        ConversationPageSchema,
      ),
    createConversation: (surface: Surface = 'windows', projectId?: string) =>
      get('/conversations', ConversationSchema, {
        method: 'POST',
        body: { surface, ...(projectId ? { projectId } : {}) },
      }),
    updateConversation: (id: string, patch: { title?: string; pinned?: boolean }) =>
      get(`/conversations/${id}`, ConversationSchema, { method: 'PATCH', body: patch }),
    archiveConversation: async (id: string) => {
      await call(`/conversations/${id}`, { method: 'DELETE' });
    },

    listMessages: (conversationId: string, before?: string) =>
      get(
        `/conversations/${conversationId}/messages${query({ before, limit: PAGE_SIZE })}`,
        MessagePageSchema,
      ),
    sendMessage: (
      conversationId: string,
      input: { text: string; role?: string | undefined; model?: string | undefined },
    ) =>
      get(`/conversations/${conversationId}/messages`, SendMessageResponseSchema, {
        method: 'POST',
        body: {
          parts: [{ type: 'text', text: input.text }],
          ...(input.role ? { role: input.role } : {}),
          ...(input.model ? { model: input.model } : {}),
        },
      }),
    rerouteMessage: (messageId: string, role: string) =>
      get(`/messages/${messageId}/reroute`, RerouteResponseSchema, {
        method: 'POST',
        body: { role },
      }),

    getRun: (id: string) => get(`/runs/${id}`, RunSchema),
    /** Keputusan atas permintaan izin agent; `remember` = selalu izinkan untuk project ini. */
    resolveApproval: (
      runId: string,
      approvalId: string,
      input: { decision: 'allow' | 'deny'; remember: boolean },
    ) =>
      get(`/runs/${runId}/approvals/${approvalId}`, ApprovalSchema, {
        method: 'POST',
        body: input,
      }),
    cancelRun: (id: string) => get(`/runs/${id}/cancel`, RunSchema, { method: 'POST' }),

    listSchedules: async () => (await get('/schedules', ScheduleListSchema)).items,
    createSchedule: (input: CreateScheduleInput) =>
      get('/schedules', ScheduleSchema, { method: 'POST', body: input }),
    updateSchedule: (id: string, patch: { enabled?: boolean; name?: string }) =>
      get(`/schedules/${id}`, ScheduleSchema, { method: 'PATCH', body: patch }),
    deleteSchedule: async (id: string) => {
      await call(`/schedules/${id}`, { method: 'DELETE' });
    },
    parseSchedule: (text: string) =>
      get('/schedules/parse', ScheduleParseResponseSchema, { method: 'POST', body: { text } }),
    runScheduleNow: (id: string) => get(`/schedules/${id}/run-now`, RunSchema, { method: 'POST' }),
    listScheduleRuns: (id: string, before?: string) =>
      get(`/schedules/${id}/runs${query({ before, limit: PAGE_SIZE })}`, ScheduleRunPageSchema),

    createResearch: (question: string, depth: ResearchDepth) =>
      get('/research', ResearchJobSchema, { method: 'POST', body: { question, depth } }),
    listResearch: (before?: string) =>
      get(`/research${query({ before, limit: PAGE_SIZE })}`, ResearchPageSchema),
    getResearch: (id: string) => get(`/research/${id}`, ResearchJobDetailSchema),
    cancelResearch: (id: string) =>
      get(`/research/${id}/cancel`, ResearchJobSchema, { method: 'POST' }),
    exportResearch: async (id: string, format: 'md' | 'pdf') =>
      (await call(`/research/${id}/export${query({ format })}`, { raw: true })) as Blob,
  };
}

export type GatewayApi = ReturnType<typeof createGatewayApi>;
