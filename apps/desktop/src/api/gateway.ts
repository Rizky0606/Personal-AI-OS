import type { ModelInfoSchema, RoleInfoSchema } from '@aios/contracts';
import {
  ApprovalSchema,
  ConversationSchema,
  FileRecordSchema,
  IdSchema,
  LoginResponseSchema,
  MemoryListSchema,
  MemorySchema,
  OpinionResponseSchema,
  PromptTemplateListSchema,
  PromptTemplateSchema,
  SearchResponseSchema,
  SpaceDocumentListSchema,
  SpaceDocumentSchema,
  SpaceListSchema,
  WorkspaceRunListSchema,
  SpaceSchema,
  MessageSchema,
  ModelListSchema,
  ProjectSchema,
  ResearchJobDetailSchema,
  ResearchJobSchema,
  CompareResponseSchema,
  QuotaSchema,
  StatusSchema,
  RerouteResponseSchema,
  ReviewResponseSchema,
  RoleListSchema,
  RunSchema,
  ScheduleParseResponseSchema,
  ScheduleRunSchema,
  ScheduleSchema,
  FleetResponseSchema,
  SendMessageResponseSchema,
  TaskBreakdownResponseSchema,
  TaskSchema,
  type CreateProjectRequestSchema,
  type CreateScheduleRequestSchema,
  type CreateTaskRequestSchema,
  type UpdateTaskRequestSchema,
  type ReviewComment,
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
const TaskListSchema = items(TaskSchema);

export type OpinionResult = z.infer<typeof OpinionResponseSchema>;
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
export type SystemStatus = z.infer<typeof StatusSchema>;
export type Quota = z.infer<typeof QuotaSchema>;
export type CompareResult = z.infer<typeof CompareResponseSchema>['results'][number];
export type CreateTaskInput = z.input<typeof CreateTaskRequestSchema>;
export type UpdateTaskInput = z.input<typeof UpdateTaskRequestSchema>;
export type TaskProposal = z.infer<typeof TaskBreakdownResponseSchema>['items'][number];
export type WorkerRegistration = z.infer<typeof LoginResponseSchema>;

export const PAGE_SIZE = 50;

export type FileRecord = z.infer<typeof FileRecordSchema>;
/** Lampiran yang sudah diunggah, siap dirujuk dari pesan. */
export interface FilePart {
  type: 'file';
  fileId: string;
  name: string;
  mime: string;
}

export interface MessageInput {
  text: string;
  files?: readonly FilePart[] | undefined;
  role?: string | undefined;
  model?: string | undefined;
  /** Run coding hanya membuat rencana (tanpa mengubah berkas). */
  planOnly?: boolean | undefined;
  /** Cari di web untuk pesan ini; hasilnya ditempel ke prompt agent. */
  webSearch?: boolean | undefined;
}

/** Teks (bila ada) lalu lampiran; server menolak pesan tanpa keduanya. */
function messageBody(input: MessageInput) {
  return {
    parts: [
      ...(input.text ? [{ type: 'text' as const, text: input.text }] : []),
      ...(input.files ?? []),
    ],
    ...(input.role ? { role: input.role } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.planOnly ? { planOnly: true } : {}),
    ...(input.webSearch ? { webSearch: true } : {}),
  };
}

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
    updateProject: (
      id: string,
      patch: { name?: string; instructions?: string; defaultBranch?: string },
    ) => get(`/projects/${id}`, ProjectSchema, { method: 'PATCH', body: patch }),
    createProject: (input: CreateProjectInput) =>
      get('/projects', ProjectSchema, { method: 'POST', body: input }),

    /** Armada agent: beberapa tugas berbeda dimulai sekaligus di satu project (maks. 4). */
    launchFleet: (input: {
      projectId: string;
      tasks: { prompt: string }[];
      planOnly?: boolean | undefined;
      model?: string | undefined;
    }) =>
      get('/fleets', FleetResponseSchema, {
        method: 'POST',
        body: {
          projectId: input.projectId,
          tasks: input.tasks,
          ...(input.planOnly ? { planOnly: true } : {}),
          ...(input.model ? { model: input.model } : {}),
        },
      }),
    listModels: async () => (await get('/models', ModelListSchema)).items,
    listRoles: async () => (await get('/roles', RoleListSchema)).items,

    listConversations: (before?: string, projectId?: string) =>
      get(
        `/conversations${query({ before, limit: PAGE_SIZE, projectId })}`,
        ConversationPageSchema,
      ),
    getConversation: (id: string) => get(`/conversations/${id}`, ConversationSchema),
    createConversation: (surface: Surface = 'windows', projectId?: string, spaceId?: string) =>
      get('/conversations', ConversationSchema, {
        method: 'POST',
        body: { surface, ...(projectId ? { projectId } : {}), ...(spaceId ? { spaceId } : {}) },
      }),
    listSpaceConversations: (spaceId: string) =>
      get(`/conversations${query({ limit: PAGE_SIZE, spaceId })}`, ConversationPageSchema),
    updateConversation: (id: string, patch: { title?: string; pinned?: boolean }) =>
      get(`/conversations/${id}`, ConversationSchema, { method: 'PATCH', body: patch }),
    archiveConversation: async (id: string) => {
      await call(`/conversations/${id}`, { method: 'DELETE' });
    },
    /** Menghapus percakapan beserta pesannya (tidak bisa dibatalkan). */
    deleteConversation: async (id: string) => {
      await call(`/conversations/${id}${query({ permanent: 'true' })}`, { method: 'DELETE' });
    },
    deleteProject: async (id: string) => {
      await call(`/projects/${id}`, { method: 'DELETE' });
    },

    listMessages: (conversationId: string, before?: string) =>
      get(
        `/conversations/${conversationId}/messages${query({ before, limit: PAGE_SIZE })}`,
        MessagePageSchema,
      ),
    sendMessage: (conversationId: string, input: MessageInput) =>
      get(`/conversations/${conversationId}/messages`, SendMessageResponseSchema, {
        method: 'POST',
        body: messageBody(input),
      }),
    /** Unggah satu lampiran (multipart, field "file"); dirujuk lewat part file saat mengirim pesan. */
    uploadFile: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return get('/files', FileRecordSchema, { method: 'POST', body: form });
    },
    /** Memotong percakapan dari pesan ini lalu mengirim teks baru (agent memulai sesi dengan riwayat sisanya). */
    editMessage: (messageId: string, input: MessageInput) =>
      get(`/messages/${messageId}/edit`, SendMessageResponseSchema, {
        method: 'POST',
        body: messageBody(input),
      }),
    /** Menghapus pesan ini beserta semua pesan sesudahnya. */
    deleteMessage: async (messageId: string) => {
      await call(`/messages/${messageId}`, { method: 'DELETE' });
    },
    /** Cabangkan percakapan dari pesan ini: pesan sampai di sini disalin ke percakapan baru. */
    forkConversation: (messageId: string) =>
      get(`/messages/${messageId}/fork`, ConversationSchema, { method: 'POST', body: {} }),
    rerouteMessage: (messageId: string, role: string) =>
      get(`/messages/${messageId}/reroute`, RerouteResponseSchema, {
        method: 'POST',
        body: { role },
      }),

    getRun: (id: string) => get(`/runs/${id}`, RunSchema),
    /** Run coding terbaru dengan judul dan project, untuk Ruang Kerja. */
    listRuns: async () => (await get('/runs?kind=coding&limit=100', WorkspaceRunListSchema)).items,
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
    /** Keputusan atas hasil run coding: terima (opsional merge), tolak, atau tolak dengan komentar. */
    reviewRun: (
      runId: string,
      input: {
        decision: 'accept' | 'reject';
        comments?: ReviewComment[];
        merge?: boolean;
        commitMessage?: string;
      },
    ) => get(`/runs/${runId}/review`, ReviewResponseSchema, { method: 'POST', body: input }),
    getStatus: () => get('/status', StatusSchema),
    getQuota: () => get('/quota', QuotaSchema),
    /** Satu prompt ke 2-3 model sekaligus; galat per model ada di hasilnya. */
    compareModels: async (prompt: string, models: string[]) =>
      (await get('/compare', CompareResponseSchema, { method: 'POST', body: { prompt, models } }))
        .results,
    /** Pendapat kedua: model lain meninjau diff dan mengembalikan ringkasan dan temuan per baris. */
    reviewOpinion: (input: { model: string; files: { path: string; patch: string }[] }) =>
      get('/review/opinion', OpinionResponseSchema, { method: 'POST', body: input }),
    listTasks: async (projectId: string) =>
      (await get(`/projects/${projectId}/tasks`, TaskListSchema)).items,
    createTask: (input: CreateTaskInput) =>
      get('/tasks', TaskSchema, { method: 'POST', body: input }),
    updateTask: (id: string, patch: UpdateTaskInput) =>
      get(`/tasks/${id}`, TaskSchema, { method: 'PATCH', body: patch }),
    /** Mengerjakan kartu dengan AI; kartu yang dikembalikan bisa antre (runId null) bila slot project penuh. */
    runTask: (id: string) => get(`/tasks/${id}/run`, TaskSchema, { method: 'POST', body: {} }),
    /** Usulan kartu dari ide; belum disimpan. */
    breakdownTasks: async (projectId: string, idea: string) =>
      (
        await get('/tasks/breakdown', TaskBreakdownResponseSchema, {
          method: 'POST',
          body: { projectId, idea },
        })
      ).items,
    cancelRun: (id: string) => get(`/runs/${id}/cancel`, RunSchema, { method: 'POST' }),

    search: async (q: string) =>
      (await get(`/search${query({ q, limit: 20 })}`, SearchResponseSchema)).items,

    listSpaces: async () => (await get('/spaces', SpaceListSchema)).items,
    createSpace: (name: string, description: string) =>
      get('/spaces', SpaceSchema, { method: 'POST', body: { name, description } }),
    updateSpace: (id: string, patch: { name?: string; description?: string }) =>
      get(`/spaces/${id}`, SpaceSchema, { method: 'PATCH', body: patch }),
    deleteSpace: async (id: string) => {
      await call(`/spaces/${id}`, { method: 'DELETE' });
    },
    listSpaceDocuments: async (spaceId: string) =>
      (await get(`/spaces/${spaceId}/documents`, SpaceDocumentListSchema)).items,
    addSpaceDocument: (spaceId: string, fileId: string) =>
      get(`/spaces/${spaceId}/documents`, SpaceDocumentSchema, {
        method: 'POST',
        body: { fileId },
      }),
    deleteSpaceDocument: async (spaceId: string, documentId: string) => {
      await call(`/spaces/${spaceId}/documents/${documentId}`, { method: 'DELETE' });
    },

    listMemories: async () => (await get('/memories', MemoryListSchema)).items,
    createMemory: (text: string) =>
      get('/memories', MemorySchema, { method: 'POST', body: { text } }),
    updateMemory: (id: string, patch: { text?: string; enabled?: boolean }) =>
      get(`/memories/${id}`, MemorySchema, { method: 'PATCH', body: patch }),
    deleteMemory: async (id: string) => {
      await call(`/memories/${id}`, { method: 'DELETE' });
    },

    /** Meringkas percakapan lalu membuka percakapan baru yang diawali ringkasan itu. */
    handoffConversation: (id: string, model: string) =>
      get(`/conversations/${id}/handoff`, ConversationSchema, { method: 'POST', body: { model } }),
    listPromptTemplates: async () =>
      (await get('/prompt-templates', PromptTemplateListSchema)).items,
    createPromptTemplate: (input: { name: string; body: string }) =>
      get('/prompt-templates', PromptTemplateSchema, { method: 'POST', body: input }),
    updatePromptTemplate: (id: string, patch: { name?: string; body?: string }) =>
      get(`/prompt-templates/${id}`, PromptTemplateSchema, { method: 'PATCH', body: patch }),
    deletePromptTemplate: async (id: string) => {
      await call(`/prompt-templates/${id}`, { method: 'DELETE' });
    },

    listSchedules: async () => (await get('/schedules', ScheduleListSchema)).items,
    createSchedule: (input: CreateScheduleInput) =>
      get('/schedules', ScheduleSchema, { method: 'POST', body: input }),
    updateSchedule: (
      id: string,
      patch: { enabled?: boolean; name?: string; notify?: 'always' | 'on_change' },
    ) => get(`/schedules/${id}`, ScheduleSchema, { method: 'PATCH', body: patch }),
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
    /** Isi berkas (lampiran atau berkas buatan agent) untuk disimpan pemilik. */
    downloadFile: async (id: string) =>
      (await call(`/files/${id}/download`, { raw: true })) as Blob,
    exportResearch: async (id: string, format: 'md' | 'pdf') =>
      (await call(`/research/${id}/export${query({ format })}`, { raw: true })) as Blob,
  };
}

export type GatewayApi = ReturnType<typeof createGatewayApi>;
