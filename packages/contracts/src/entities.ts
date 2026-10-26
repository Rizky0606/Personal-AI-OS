import { z } from 'zod';
import {
  DeviceKindSchema,
  EngineSchema,
  IdSchema,
  RoleIdSchema,
  RunErrorSchema,
  ScopeSchema,
  SurfaceSchema,
  TimestampSchema,
  UsageSchema,
} from './common.js';
import { RunStatusSchema } from './run-status.js';

/*
 * Entitas "Model data inti" (API_CONTRACT.md) sebagai bentuk di API: camelCase.
 * Kolom internal tidak diekspos ke klien: token_hash, push_token, content (isi berkas),
 * hermes_session_id. Bentuk baris DB didefinisikan di gateway (Drizzle).
 * createdAt/updatedAt ditambahkan untuk pengurutan dan sinkronisasi.
 */

export const DeviceSchema = z
  .object({
    id: IdSchema,
    kind: DeviceKindSchema,
    name: z.string().min(1),
    scopes: z.array(ScopeSchema),
    lastSeenAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
  })
  .meta({ id: 'Device' });
export type Device = z.infer<typeof DeviceSchema>;

export const ConversationSchema = z
  .object({
    id: IdSchema,
    title: z.string(),
    surface: SurfaceSchema,
    projectId: IdSchema.nullable(),
    /** Ruang pengetahuan (W21): jawaban di percakapan ini memakai dokumen ruang itu sebagai sumber. */
    spaceId: IdSchema.nullable(),
    pinned: z.boolean(),
    archivedAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'Conversation' });
export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageAuthorSchema = z.enum(['user', 'assistant', 'system']);
export type MessageAuthor = z.infer<typeof MessageAuthorSchema>;

export const ToolStepStatusSchema = z.enum(['running', 'ok', 'error', 'denied', 'cancelled']);
export type ToolStepStatus = z.infer<typeof ToolStepStatusSchema>;

export const TextPartSchema = z.object({ type: z.literal('text'), text: z.string() });
export const FilePartSchema = z.object({
  type: z.literal('file'),
  fileId: IdSchema,
  name: z.string(),
  mime: z.string(),
});
export const ToolPartSchema = z.object({
  type: z.literal('tool'),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  target: z.string().optional(),
  status: ToolStepStatusSchema,
  durationMs: z.number().int().nonnegative().optional(),
});

export const MessagePartSchema = z
  .discriminatedUnion('type', [TextPartSchema, FilePartSchema, ToolPartSchema])
  .meta({ id: 'MessagePart' });
export type MessagePart = z.infer<typeof MessagePartSchema>;

/** Bagian yang boleh dikirim pengguna. */
export const MessagePartInputSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  FilePartSchema,
]);
export type MessagePartInput = z.infer<typeof MessagePartInputSchema>;

export const MessageSchema = z
  .object({
    id: IdSchema,
    conversationId: IdSchema,
    author: MessageAuthorSchema,
    parts: z.array(MessagePartSchema),
    agentRole: RoleIdSchema.nullable(),
    model: z.string().nullable(),
    runId: IdSchema.nullable(),
    createdAt: TimestampSchema,
  })
  .meta({ id: 'Message' });
export type Message = z.infer<typeof MessageSchema>;

export const RunKindSchema = z.enum(['chat', 'coding', 'research', 'schedule']);
export type RunKind = z.infer<typeof RunKindSchema>;

export const RunSchema = z
  .object({
    id: IdSchema,
    kind: RunKindSchema,
    engine: EngineSchema,
    agentRole: RoleIdSchema.nullable(),
    model: z.string().nullable(),
    status: RunStatusSchema,
    conversationId: IdSchema.nullable(),
    taskId: IdSchema.nullable(),
    branch: z.string().nullable(),
    usage: UsageSchema.nullable(),
    error: RunErrorSchema.nullable(),
    /** Run coding mode rencana: hanya membaca dan menulis rencana, tanpa perubahan berkas (W29). */
    planOnly: z.boolean().default(false),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'Run' });
export type Run = z.infer<typeof RunSchema>;

export const ApprovalKindSchema = z.enum(['command', 'file_write', 'network']);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const ApprovalDecisionSchema = z.enum(['allow', 'deny']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalStatusSchema = z.enum(['pending', 'allowed', 'denied', 'cancelled']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalSchema = z
  .object({
    id: IdSchema,
    runId: IdSchema,
    kind: ApprovalKindSchema,
    /** Perintah, path, atau URL persis yang diminta. */
    detail: z.string(),
    status: ApprovalStatusSchema,
    remember: z.boolean(),
    decidedAt: TimestampSchema.nullable(),
  })
  .meta({ id: 'Approval' });
export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalRuleSchema = z
  .object({
    projectId: IdSchema,
    pattern: z.string().min(1),
    decision: ApprovalDecisionSchema,
  })
  .meta({ id: 'ApprovalRule' });
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;

/** Hasil deteksi stack; path project tetap lokal di worker dan tidak ada di sini. */
export const StackSchema = z
  .object({
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    packageManager: z.string().optional(),
    /** Perintah dev server sebagai array argumen, bukan string gabungan. */
    devCommand: z.array(z.string()).optional(),
  })
  .meta({ id: 'Stack' });
export type Stack = z.infer<typeof StackSchema>;

/** Batas panjang aturan project; ikut di setiap pesan sistem run project. */
export const PROJECT_INSTRUCTIONS_MAX = 4000;

export const ProjectSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    workerDeviceId: IdSchema,
    stack: StackSchema,
    defaultBranch: z.string().min(1),
    /** Aturan project (W23): gaya kode, perintah tes, larangan; disuntik ke setiap run di project ini. */
    instructions: z.string().max(PROJECT_INSTRUCTIONS_MAX),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'Project' });
export type Project = z.infer<typeof ProjectSchema>;

export const TaskStatusSchema = z.enum(['backlog', 'todo', 'running', 'review', 'done']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const DiffStatSchema = z
  .object({
    files: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  })
  .meta({ id: 'DiffStat' });
export type DiffStat = z.infer<typeof DiffStatSchema>;

export const TaskSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    title: z.string().min(1),
    body: z.string(),
    status: TaskStatusSchema,
    position: z.number().int().nonnegative(),
    agentRole: RoleIdSchema.nullable(),
    runId: IdSchema.nullable(),
    branch: z.string().nullable(),
    diffStat: DiffStatSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'Task' });
export type Task = z.infer<typeof TaskSchema>;

/** Lima field cron standar, dipisah spasi. Validasi isi dilakukan scheduler. */
export const CronSchema = z.string().regex(/^\S+(\s+\S+){4}$/, 'cron harus 5 field');

/** `briefing` (W18): rangkuman harian riset, kanban, dan jadwal 24 jam terakhir, ditambah topik di prompt. */
export const ScheduleTargetSchema = z.enum(['chat', 'research', 'role', 'briefing']);
export type ScheduleTarget = z.infer<typeof ScheduleTargetSchema>;

/**
 * Kapan hasil jadwal diberitahukan (W19). `on_change`: hasil run sebelumnya ikut dikirim ke agent, dan push
 * hanya dikirim bila agent menyatakan ada perubahan. Tidak berlaku untuk target `research`.
 */
export const ScheduleNotifySchema = z.enum(['always', 'on_change']);
export type ScheduleNotify = z.infer<typeof ScheduleNotifySchema>;

export const DEFAULT_TIMEZONE = 'Asia/Jakarta';

export const ScheduleSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    cron: CronSchema,
    timezone: z.string().min(1),
    prompt: z.string().min(1),
    target: ScheduleTargetSchema,
    agentRole: RoleIdSchema.nullable(),
    enabled: z.boolean(),
    notify: ScheduleNotifySchema,
    nextRunAt: TimestampSchema.nullable(),
    /** Percakapan khusus jadwal ini; hasil tiap run tersimpan sebagai pesan di sana. */
    conversationId: IdSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'Schedule' });
export type Schedule = z.infer<typeof ScheduleSchema>;

/** `missed`: kemunculan jadwal yang tidak dijalankan (server mati atau run sebelumnya masih berjalan). */
export const ScheduleRunStatusSchema = z.enum(['running', 'succeeded', 'failed', 'missed']);
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatusSchema>;

export const ScheduleRunSchema = z
  .object({
    id: IdSchema,
    scheduleId: IdSchema,
    runId: IdSchema.nullable(),
    status: ScheduleRunStatusSchema,
    startedAt: TimestampSchema,
    finishedAt: TimestampSchema.nullable(),
    /** Jadwal `on_change`: false bila hasilnya sama dengan run sebelumnya (tanpa push); null bila tidak dibandingkan. */
    changed: z.boolean().nullable(),
  })
  .meta({ id: 'ScheduleRun' });
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;

export const ResearchDepthSchema = z.enum(['quick', 'standard', 'deep']);
export type ResearchDepth = z.infer<typeof ResearchDepthSchema>;

export const ResearchStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type ResearchStatus = z.infer<typeof ResearchStatusSchema>;

export const ResearchPlanSchema = z.object({ subQuestions: z.array(z.string()) });

export const ResearchJobSchema = z
  .object({
    id: IdSchema,
    question: z.string().min(1),
    depth: ResearchDepthSchema,
    status: ResearchStatusSchema,
    plan: ResearchPlanSchema.nullable(),
    reportMd: z.string().nullable(),
    runId: IdSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'ResearchJob' });
export type ResearchJob = z.infer<typeof ResearchJobSchema>;

export const ResearchSourceSchema = z
  .object({
    id: IdSchema,
    jobId: IdSchema,
    url: z.url(),
    title: z.string(),
    fetchedAt: TimestampSchema.nullable(),
    used: z.boolean(),
  })
  .meta({ id: 'ResearchSource' });
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const FileRecordSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    mime: z.string().min(1),
    size: z.number().int().nonnegative().max(MAX_FILE_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: TimestampSchema,
  })
  .meta({ id: 'FileRecord' });
export type FileRecord = z.infer<typeof FileRecordSchema>;

export const RoutingDecisionSchema = z
  .object({
    id: IdSchema,
    messageId: IdSchema,
    role: RoleIdSchema,
    confidence: z.number().min(0).max(1),
    reason: z.string(),
    latencyMs: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
  })
  .meta({ id: 'RoutingDecision' });
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export const RoutingCorrectionSchema = z
  .object({
    id: IdSchema,
    decisionId: IdSchema,
    fromRole: RoleIdSchema,
    toRole: RoleIdSchema,
    messageExcerpt: z.string(),
    createdAt: TimestampSchema,
  })
  .meta({ id: 'RoutingCorrection' });
export type RoutingCorrection = z.infer<typeof RoutingCorrectionSchema>;

export const AuditLogSchema = z
  .object({
    id: IdSchema,
    actorDeviceId: IdSchema.nullable(),
    action: z.string().min(1),
    target: z.string(),
    ts: TimestampSchema,
  })
  .meta({ id: 'AuditLog' });
export type AuditLog = z.infer<typeof AuditLogSchema>;

/** Nama templat prompt: dipanggil dengan `/nama` di composer, jadi huruf kecil, angka, dan strip. */
export const PROMPT_TEMPLATE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const PROMPT_TEMPLATE_BODY_MAX = 4000;

/** Prompt tersimpan; `{{parameter}}` di isinya diisi pengguna saat dipakai. */
export const PromptTemplateSchema = z
  .object({
    id: IdSchema,
    name: z.string().regex(PROMPT_TEMPLATE_NAME_RE),
    body: z.string().min(1).max(PROMPT_TEMPLATE_BODY_MAX),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'PromptTemplate' });
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

/** Batas panjang satu fakta memori; cukup untuk satu atau dua kalimat. */
export const MEMORY_TEXT_MAX = 500;

/** Fakta tentang pemilik yang disuntik ke pesan sistem setiap run (W17). Dikelola pemilik, bukan diisi otomatis. */
export const MemorySchema = z
  .object({
    id: IdSchema,
    text: z.string().min(1).max(MEMORY_TEXT_MAX),
    /** Memori nonaktif tetap tersimpan tetapi tidak disuntik ke agent. */
    enabled: z.boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'Memory' });
export type Memory = z.infer<typeof MemorySchema>;

/** Ruang pengetahuan (W21): kumpulan dokumen yang menjadi sumber jawaban bersitasi di percakapan ruang itu. */
export const SpaceSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(120),
    description: z.string(),
    documentCount: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'Space' });
export type Space = z.infer<typeof SpaceSchema>;

/** Dokumen di ruang: teksnya sudah diekstrak dan dipotong per bagian untuk pencarian. */
export const SpaceDocumentSchema = z
  .object({
    id: IdSchema,
    spaceId: IdSchema,
    fileId: IdSchema,
    name: z.string().min(1),
    chars: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
  })
  .meta({ id: 'SpaceDocument' });
export type SpaceDocument = z.infer<typeof SpaceDocumentSchema>;
