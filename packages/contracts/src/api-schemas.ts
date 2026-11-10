import { z } from 'zod';
import {
  DEFAULT_TIMEZONE,
  CronSchema,
  ApprovalDecisionSchema,
  ApprovalSchema,
  SteerModeSchema,
  DeviceSchema,
  MEMORY_TEXT_MAX,
  MemorySchema,
  PROMPT_TEMPLATE_BODY_MAX,
  PROMPT_TEMPLATE_NAME_RE,
  PromptTemplateSchema,
  MessagePartInputSchema,
  SpaceDocumentSchema,
  SpaceSchema,
  MessageSchema,
  PROJECT_INSTRUCTIONS_MAX,
  ResearchDepthSchema,
  ResearchJobSchema,
  ResearchSourceSchema,
  RunKindSchema,
  RunSchema,
  ScheduleNotifySchema,
  ScheduleTargetSchema,
  StackSchema,
  TaskStatusSchema,
  TeamAssignmentSchema,
} from './entities.js';
import {
  DeviceKindSchema,
  EngineSchema,
  IdSchema,
  PageQuerySchema,
  RoleIdSchema,
  SurfaceSchema,
  TimestampSchema,
  UsageSchema,
} from './common.js';
import {
  DiffFileSchema,
  QueueNameSchema,
  QuestionAnswerSchema,
  RunEventSchema,
  TeamStatusSchema,
  TodoPhaseSchema,
} from './events.js';
import { MergeSkippedSchema, ReviewCommentSchema } from './worker.js';
import { RichAnswerFollowUpSchema } from './rich-answers.js';

/*
 * Request dan response setiap endpoint REST (API_CONTRACT.md, "Endpoint REST").
 * Semua path relatif terhadap /v1. Error memakai ProblemSchema (application/problem+json).
 */

export const IdParamsSchema = z.object({ id: IdSchema });
export const itemsOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/* Auth */

export const LoginRequestSchema = z
  .object({
    password: z.string().min(1),
    totp: z.string().regex(/^\d{6}$/, 'TOTP 6 digit'),
    device: z.object({ name: z.string().min(1), kind: DeviceKindSchema }),
    pushToken: z.string().min(1).optional(),
  })
  .meta({ id: 'LoginRequest' });

export const TokenPairSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    /** Masa berlaku access token dalam detik (900 = 15 menit). */
    expiresIn: z.number().int().positive(),
  })
  .meta({ id: 'TokenPair' });

export const LoginResponseSchema = z
  .object({ ...TokenPairSchema.shape, device: DeviceSchema })
  .meta({ id: 'LoginResponse' });

export const RefreshRequestSchema = z
  .object({ refreshToken: z.string().min(1) })
  .meta({ id: 'RefreshRequest' });

/* Perangkat */

/** Desktop mendaftarkan worker sidecar-nya; gateway membuat perangkat kind `worker` (scope worker + llm). */
export const RegisterWorkerRequestSchema = z
  .object({ name: z.string().min(1).max(100) })
  .meta({ id: 'RegisterWorkerRequest' });

export const DeviceListSchema = itemsOf(DeviceSchema).meta({ id: 'DeviceList' });
export const PushTokenRequestSchema = z
  .object({ pushToken: z.string().min(1) })
  .meta({ id: 'PushTokenRequest' });

/* Model, kuota, role, router */

export const ModelInfoSchema = z
  .object({
    id: z.string().min(1),
    /** Nama ramah untuk pemilih model; `id` tetap nilai yang dikirim ke API. */
    label: z.string().min(1),
    kind: z.enum(['model', 'combo']),
    ownedBy: z.string(),
  })
  .meta({ id: 'ModelInfo' });
export const ModelListSchema = itemsOf(ModelInfoSchema).meta({ id: 'ModelList' });

/**
 * Mesin yang dilaporkan gateway beserta kemampuannya (`GET /engines`). `available=false`: belum dikonfigurasi atau
 * pemeriksaan kesehatannya gagal; `reason` menjelaskannya untuk ditampilkan klien. Pilihan per pesan (`SendMessageRequest.engine`)
 * hanya dibutuhkan untuk `dsh`; hermes dan omp dipilih otomatis menurut konteks (chat umum atau project).
 */
export const EngineInfoSchema = z
  .object({
    id: EngineSchema,
    label: z.string().min(1),
    available: z.boolean(),
    /** Developer preview / tidak diaudit; klien menampilkan penanda. */
    experimental: z.boolean(),
    /** Alasan tidak tersedia, untuk ditampilkan apa adanya. */
    reason: z.string().min(1).optional(),
    /** Mesin menerima model pilihan pengguna per pesan; bila false, model diatur di sisi mesin. */
    supportsModelPick: z.boolean(),
    /** Mesin mengirim rencana langkah (tool todo) untuk panel Progres. */
    supportsTodo: z.boolean(),
  })
  .meta({ id: 'EngineInfo' });
export const EngineListSchema = itemsOf(EngineInfoSchema).meta({ id: 'EngineList' });
export type EngineInfo = z.infer<typeof EngineInfoSchema>;

const UsageTotalsShape = {
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
};

export const QuotaSchema = z
  .object({
    /** `ninerouter` bila 9Router menyediakan usage; `runs` bila diringkas dari tabel runs. */
    source: z.enum(['ninerouter', 'runs']),
    totals: z.object(UsageTotalsShape),
    byModel: z.array(z.object({ model: z.string(), ...UsageTotalsShape })),
    byDay: z.array(z.object({ date: z.iso.date(), ...UsageTotalsShape })),
  })
  .meta({ id: 'Quota' });

export const MAX_COMPARE_MODELS = 3;

export const CompareRequestSchema = z
  .object({
    prompt: z.string().min(1).max(8000),
    /** 2 sampai 3 model berbeda (id dari GET /models). */
    models: z
      .array(z.string().min(1))
      .min(2)
      .max(MAX_COMPARE_MODELS)
      .refine((m) => new Set(m).size === m.length, 'model tidak boleh sama'),
  })
  .meta({ id: 'CompareRequest' });

export const CompareResultSchema = z.object({
  model: z.string(),
  ok: z.boolean(),
  text: z.string(),
  /** Waktu sampai jawaban lengkap, ms. */
  latencyMs: z.number().int().nonnegative(),
  usage: UsageSchema.nullable(),
  /** Pesan galat per model; model lain tetap menjawab. */
  error: z.string().nullable(),
});

export const CompareResponseSchema = z
  .object({ results: z.array(CompareResultSchema) })
  .meta({ id: 'CompareResponse' });

/** Batas masukan pendapat kedua: diff yang lebih besar dipotong gateway sebelum dikirim ke model. */
export const OPINION_MAX_FILES = 50;
export const OPINION_MAX_PATCH_CHARS = 200_000;

export const OpinionRequestSchema = z
  .object({
    /** Model peninjau (id dari GET /models), idealnya berbeda dari model agent yang menulis kodenya. */
    model: z.string().min(1),
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(500),
          patch: z.string().max(OPINION_MAX_PATCH_CHARS),
        }),
      )
      .min(1)
      .max(OPINION_MAX_FILES),
  })
  .meta({ id: 'OpinionRequest' });

export const OpinionSeveritySchema = z.enum(['info', 'warning', 'bug']);
export const OpinionFindingSchema = z.object({
  path: z.string(),
  /** Nomor baris di berkas sesudah perubahan; null bila temuan berlaku untuk seluruh berkas. */
  line: z.number().int().min(1).nullable(),
  severity: OpinionSeveritySchema,
  body: z.string().min(1).max(1000),
});
export type OpinionFinding = z.infer<typeof OpinionFindingSchema>;
export const OpinionResponseSchema = z
  .object({
    model: z.string(),
    summary: z.string(),
    findings: z.array(OpinionFindingSchema),
    /** Sebagian diff tidak ikut ditinjau karena terlalu besar. */
    truncated: z.boolean(),
  })
  .meta({ id: 'OpinionResponse' });

export const RoleInfoSchema = z
  .object({
    id: RoleIdSchema,
    name: z.string().min(1),
    group: z.enum(['coding', 'umum']),
    engine: z.enum(['omp', 'hermes', 'research']),
    model: z.string().min(1),
    fallbackModel: z.string().nullable(),
    approval: z.enum(['ask', 'auto-safe']),
    skills: z.array(z.string()),
  })
  .meta({ id: 'RoleInfo' });
export const RoleListSchema = itemsOf(RoleInfoSchema).meta({ id: 'RoleList' });

/** Asal satu skill di katalog (P9): bawaan repo, folder data gateway (user), dipasang (installed), atau dibuat agent. */
export const SkillSourceSchema = z.enum(['builtin', 'user', 'installed', 'agent']);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

/** Indeks `GET /skills`: tanpa isi, agent memilih dari sini sebelum membuka skill tertentu. */
export const SkillSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** Satu kalimat, maks 200 karakter, menyebut kapan skill ini dipakai. */
    description: z.string().min(1).max(200),
    version: z.string().min(1),
    source: SkillSourceSchema,
    /** sha256 isi skill (tanpa frontmatter); berubah bila isi berubah. */
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .meta({ id: 'SkillSummary' });
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
export const SkillListSchema = itemsOf(SkillSummarySchema).meta({ id: 'SkillList' });

/** `GET /skills/:id`: indeks + isi lengkap (dipakai klien yang menampilkan isi, dan dasar sinkron ke Hermes). */
export const SkillDetailSchema = SkillSummarySchema.extend({ body: z.string() }).meta({
  id: 'SkillDetail',
});
export type SkillDetail = z.infer<typeof SkillDetailSchema>;

/* Percakapan dan pesan */

export const ListConversationsQuerySchema = z.object({
  ...PageQuerySchema.shape,
  projectId: IdSchema.optional(),
  /** Hanya percakapan di ruang ini. */
  spaceId: IdSchema.optional(),
  archived: z.enum(['true', 'false']).optional(),
});

/** `permanent=true` menghapus percakapan beserta pesannya; tanpa itu percakapan hanya diarsipkan. */
export const DeleteConversationQuerySchema = z.object({
  permanent: z.enum(['true', 'false']).optional(),
});

export const CreateConversationRequestSchema = z
  .object({
    title: z.string().optional(),
    surface: SurfaceSchema,
    projectId: IdSchema.optional(),
    spaceId: IdSchema.optional(),
  })
  .meta({ id: 'CreateConversationRequest' });

export const UpdateConversationRequestSchema = z
  .object({
    title: z.string().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .meta({ id: 'UpdateConversationRequest' });

export const SendMessageRequestSchema = z
  .object({
    parts: z.array(MessagePartInputSchema).min(1),
    /** Skill spesialis tambahan untuk pesan ini; menang atas pemilihan otomatis dari kata kunci. */
    skills: z.array(z.string().min(1)).max(12).optional(),
    /** Skill yang dicabut untuk pesan ini, walau cocok dengan kata kunci. */
    skillsOff: z.array(z.string().min(1)).max(12).optional(),
    model: z.string().min(1).optional(),
    /** Run coding hanya membaca dan menulis rencana; izin menulis dan menjalankan perintah ditolak. */
    planOnly: z.boolean().optional(),
    /** Cari di web untuk pesan ini: hasil pencarian bernomor ditempel ke prompt agent (chat umum dan project). */
    webSearch: z.boolean().optional(),
    /**
     * Memaksa mesin untuk pesan ini; tanpa ini gateway memilih menurut konteks. `omp` hanya di percakapan project
     * (ditolak 422 `project_required` di chat umum); `hermes` di dalam project merutekan ke agent umum lewat Hermes
     * (obrolan tanpa folder project); `dsh` hanya di chat umum (ditolak 422 `engine_not_for_project` di project).
     */
    engine: z.enum(['hermes', 'omp', 'dsh']).optional(),
    /** Aksi komponen rich answer; dikirim sebagai pesan user baru, bukan efek samping lokal. */
    followUp: RichAnswerFollowUpSchema.optional(),
  })
  .meta({ id: 'SendMessageRequest' });

/** Paling banyak tugas dalam satu armada, dan batas run yang sedang berjalan per project. */
export const MAX_FLEET_TASKS = 4;

/**
 * Armada agent: beberapa tugas berbeda dimulai bersamaan di satu project; tiap tugas jadi percakapan sendiri dan
 * run coding sendiri di worktree sendiri.
 */
export const FleetRequestSchema = z
  .object({
    projectId: IdSchema,
    tasks: z
      .array(z.object({ prompt: z.string().trim().min(1).max(4000) }))
      .min(1)
      .max(MAX_FLEET_TASKS),
    /** Semua agent hanya membuat rencana (tanpa mengubah berkas). */
    planOnly: z.boolean().optional(),
    model: z.string().min(1).optional(),
  })
  .meta({ id: 'FleetRequest' });

export const FleetResponseSchema = z
  .object({
    items: z.array(z.object({ conversationId: IdSchema, title: z.string(), run: RunSchema })),
    /** Tugas yang gagal dimulai (yang lain tetap berjalan). */
    failed: z.number().int().nonnegative(),
  })
  .meta({ id: 'FleetResponse' });

export const TeamLimitsSchema = z
  .object({
    maxWorkers: z.number().int().min(1).max(1).default(1),
    maxReviewRounds: z.number().int().min(0).max(2).default(2),
    teamTimeoutMinutes: z.number().int().min(1).max(120).default(120),
    memberTimeoutMinutes: z.number().int().min(1).max(30).default(30),
    stepsPerMember: z.number().int().min(1).max(100).default(100),
    tokensPerTeam: z.number().int().min(1).max(100_000).default(100_000),
    tokensPerMember: z.number().int().min(1).max(40_000).default(40_000),
    inputTokensPerCall: z.number().int().min(1).max(20_000).default(20_000),
    outputTokensPerCall: z.number().int().min(1).max(8_000).default(8_000),
  })
  .strict()
  .meta({ id: 'TeamLimits' });

export const TeamRequestSchema = z
  .object({
    projectId: IdSchema,
    prompt: z.string().trim().min(1).max(20_000),
    model: z.string().min(1).optional(),
    limits: TeamLimitsSchema.default({
      maxWorkers: 1,
      maxReviewRounds: 2,
      teamTimeoutMinutes: 120,
      memberTimeoutMinutes: 30,
      stepsPerMember: 100,
      tokensPerTeam: 100_000,
      tokensPerMember: 40_000,
      inputTokensPerCall: 20_000,
      outputTokensPerCall: 8_000,
    }),
  })
  .strict()
  .meta({ id: 'TeamRequest' });

export const TeamSummarySchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    status: TeamStatusSchema,
    memberCount: z.number().int().nonnegative(),
    pendingApprovals: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'TeamSummary' });

export const TeamMemberSummarySchema = z
  .object({
    id: IdSchema,
    role: z.enum(['lead', 'worker']),
    status: z.enum([
      'queued',
      'running',
      'reviewing',
      'completed',
      'failed',
      'cancelled',
      'needs_attention',
    ]),
    task: z.string(),
    branch: z.string().nullable(),
    runId: IdSchema,
    /** Percakapan run ini; dipakai UI untuk membuka chat anggota (Lead) langsung setelah tim dibuat. */
    conversationId: IdSchema.nullable().optional(),
    updatedAt: TimestampSchema,
    exitReason: z.string().nullable(),
  })
  .meta({ id: 'TeamMemberSummary' });

/** Satu persetujuan menunggu milik anggota tim; dikumpulkan jadi satu daftar di tab Aktivitas (ORCA_DESIGN.md tugas 9). */
export const TeamApprovalSchema = z
  .object({ ...ApprovalSchema.shape, memberId: IdSchema, memberRole: z.enum(['lead', 'worker']) })
  .meta({ id: 'TeamApproval' });

export const TeamDetailSchema = z
  .object({
    ...TeamSummarySchema.shape,
    parentRunId: IdSchema.nullable(),
    prompt: z.string(),
    limits: TeamLimitsSchema,
    members: z.array(TeamMemberSummarySchema),
    assignments: z.array(TeamAssignmentSchema).default([]),
    /** Persetujuan tertunda dari semua anggota, agregat (additive; count tetap di pendingApprovals). */
    approvals: z.array(TeamApprovalSchema).default([]),
    cancelRequestedAt: TimestampSchema.nullable(),
    failureCode: z.string().nullable(),
    finishedAt: TimestampSchema.nullable(),
  })
  .meta({ id: 'TeamDetail' });

export const TeamListSchema = z
  .object({ items: z.array(TeamSummarySchema) })
  .meta({ id: 'TeamList' });
export const SendMessageResponseSchema = z
  .object({ message: MessageSchema, run: RunSchema })
  .meta({ id: 'SendMessageResponse' });

/** Lanjut dengan ringkasan (W30): model yang meringkas percakapan sebelum membuka percakapan baru. */
export const HandoffRequestSchema = z
  .object({ model: z.string().min(1) })
  .meta({ id: 'HandoffRequest' });

/* Run */

/** Nomor urut event per run dimulai dari 1. afterSeq=0 berarti dari awal. */
export const RunEventsQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const RunEventsResponseSchema = z
  .object({
    items: z.array(RunEventSchema),
    lastSeq: z.number().int().nonnegative(),
  })
  .meta({ id: 'RunEventsResponse' });

export const SteerRequestSchema = z
  .object({ text: z.string().min(1), mode: SteerModeSchema.optional() })
  .meta({ id: 'SteerRequest' });

export const ApprovalParamsSchema = z.object({ id: IdSchema, approvalId: IdSchema });

export const ApprovalDecisionRequestSchema = z
  .object({
    decision: ApprovalDecisionSchema,
    remember: z.boolean().default(false),
  })
  .meta({ id: 'ApprovalDecisionRequest' });

export const QuestionParamsSchema = z.object({ id: IdSchema, questionId: IdSchema });

/** Params untuk aksi per-anggota tim (mis. hentikan satu Worker tanpa membatalkan seluruh tim). */
export const TeamMemberParamsSchema = z.object({ id: IdSchema, memberId: IdSchema });

/** Menarik satu arahan dari antrean agent sebelum diproses; `text` persis seperti di event `queue.updated`. */
export const RemoveQueuedRequestSchema = z
  .object({ queue: QueueNameSchema, text: z.string().min(1).max(500) })
  .meta({ id: 'RemoveQueuedRequest' });

/** Jawaban atas pertanyaan agent: `cancelled` true membatalkan (agent memakai pilihan yang direkomendasikan). */
export const QuestionAnswerRequestSchema = z
  .object({
    answers: z.array(QuestionAnswerSchema).max(8).default([]),
    cancelled: z.boolean().default(false),
  })
  .meta({ id: 'QuestionAnswerRequest' });

/**
 * Tinjauan hasil run coding. `accept`: perubahan di-commit pada branch kerja agent; `merge` juga menggabungkannya
 * ke branch kerja pengguna. `reject` tanpa komentar membuang worktree; `reject` dengan komentar mengembalikan
 * hasil ke agent (run baru di worktree yang sama, komentar dibundel jadi satu pesan).
 */
export const ReviewRequestSchema = z
  .object({
    decision: z.enum(['accept', 'reject']),
    comments: z.array(ReviewCommentSchema).default([]),
    /** Hanya untuk `accept`: gabungkan ke branch kerja pengguna (bila bersih); default hanya membiarkan branch. */
    merge: z.boolean().default(false),
    /** Pesan commit Conventional Commits; kosong = pesan buatan agent. */
    commitMessage: z.string().trim().min(1).max(200).optional(),
  })
  .meta({ id: 'ReviewRequest' });

export const ReviewResponseSchema = z
  .object({
    /** Run yang ditinjau setelah keputusan (accepted atau rejected). */
    run: RunSchema,
    branch: z.string(),
    /** SHA commit hasil terima; null bila ditolak atau tidak ada perubahan. */
    commit: z.string().nullable(),
    merged: z.boolean(),
    /** Alasan penggabungan dilewati; branch tetap ada. */
    mergeSkipped: MergeSkippedSchema.nullable(),
    /** Id run baru bila hasil dikembalikan ke agent dengan komentar. */
    revisionRunId: IdSchema.nullable(),
  })
  .meta({ id: 'ReviewResponse' });

/* Project dan kanban */

export const CreateProjectRequestSchema = z
  .object({
    name: z.string().min(1),
    workerDeviceId: IdSchema,
    stack: StackSchema,
    defaultBranch: z.string().min(1).default('main'),
    instructions: z.string().trim().max(PROJECT_INSTRUCTIONS_MAX).default(''),
  })
  .meta({ id: 'CreateProjectRequest' });

export const UpdateProjectRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    stack: StackSchema.optional(),
    defaultBranch: z.string().min(1).optional(),
    instructions: z.string().trim().max(PROJECT_INSTRUCTIONS_MAX).optional(),
  })
  .meta({ id: 'UpdateProjectRequest' });

export const CreateTaskRequestSchema = z
  .object({
    projectId: IdSchema,
    title: z.string().min(1),
    body: z.string().default(''),
    status: TaskStatusSchema.default('backlog'),
    agentRole: RoleIdSchema.nullable().optional(),
  })
  .meta({ id: 'CreateTaskRequest' });

export const UpdateTaskRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().optional(),
    status: TaskStatusSchema.optional(),
    position: z.number().int().nonnegative().optional(),
    agentRole: RoleIdSchema.nullable().optional(),
  })
  .meta({ id: 'UpdateTaskRequest' });

export const RunTaskRequestSchema = z
  .object({ model: z.string().min(1).optional() })
  .meta({ id: 'RunTaskRequest' });

export const TaskBreakdownRequestSchema = z
  .object({ projectId: IdSchema, idea: z.string().min(1) })
  .meta({ id: 'TaskBreakdownRequest' });

export const TaskBreakdownResponseSchema = z
  .object({
    items: z.array(
      z.object({
        title: z.string().min(1),
        body: z.string(),
        agentRole: RoleIdSchema.nullable(),
      }),
    ),
  })
  .meta({ id: 'TaskBreakdownResponse' });

/* Jadwal */

export const CreateScheduleRequestSchema = z
  .object({
    name: z.string().min(1),
    cron: CronSchema,
    timezone: z.string().min(1).default(DEFAULT_TIMEZONE),
    prompt: z.string().min(1),
    target: ScheduleTargetSchema,
    agentRole: RoleIdSchema.nullable().optional(),
    enabled: z.boolean().default(true),
    notify: ScheduleNotifySchema.default('always'),
  })
  .meta({ id: 'CreateScheduleRequest' });

export const SpaceListSchema = itemsOf(SpaceSchema).meta({ id: 'SpaceList' });
export const SpaceDocumentListSchema = itemsOf(SpaceDocumentSchema).meta({
  id: 'SpaceDocumentList',
});
export const CreateSpaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(''),
  })
  .meta({ id: 'CreateSpaceRequest' });
export const UpdateSpaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .meta({ id: 'UpdateSpaceRequest' });
export const AddSpaceDocumentRequestSchema = z
  .object({ fileId: IdSchema })
  .meta({ id: 'AddSpaceDocumentRequest' });
export const SpaceDocumentParamsSchema = z.object({ id: IdSchema, documentId: IdSchema });

/* Pencarian riwayat (W22) */

/** Ringkasan run untuk Ruang Kerja: run beserta judul (kartu atau percakapan) dan project-nya. */
export const WorkspaceRunSchema = z
  .object({
    run: RunSchema,
    title: z.string(),
    projectId: IdSchema.nullable(),
    projectName: z.string().nullable(),
  })
  .meta({ id: 'WorkspaceRun' });
export const WorkspaceRunListSchema = itemsOf(WorkspaceRunSchema).meta({ id: 'WorkspaceRunList' });
export const ListRunsQuerySchema = z.object({
  kind: RunKindSchema.default('coding'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const SearchResultSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('message'),
      messageId: IdSchema,
      conversationId: IdSchema,
      /** Judul percakapan (bisa kosong bila judul otomatis belum dibuat). */
      title: z.string(),
      /** Potongan teks di sekitar kata yang cocok. */
      snippet: z.string(),
      createdAt: TimestampSchema,
    }),
    z.object({
      kind: z.literal('research'),
      researchId: IdSchema,
      title: z.string(),
      snippet: z.string(),
      createdAt: TimestampSchema,
    }),
  ])
  .meta({ id: 'SearchResult' });
export type SearchResult = z.infer<typeof SearchResultSchema>;
export const SearchResponseSchema = itemsOf(SearchResultSchema).meta({ id: 'SearchResponse' });

export const PromptTemplateListSchema = itemsOf(PromptTemplateSchema).meta({
  id: 'PromptTemplateList',
});
const TemplateNameSchema = z.string().trim().toLowerCase().regex(PROMPT_TEMPLATE_NAME_RE);
const TemplateBodySchema = z.string().trim().min(1).max(PROMPT_TEMPLATE_BODY_MAX);
export const CreatePromptTemplateRequestSchema = z
  .object({ name: TemplateNameSchema, body: TemplateBodySchema })
  .meta({ id: 'CreatePromptTemplateRequest' });
export const UpdatePromptTemplateRequestSchema = z
  .object({ name: TemplateNameSchema.optional(), body: TemplateBodySchema.optional() })
  .refine((v) => v.name !== undefined || v.body !== undefined, {
    message: 'Kirim name atau body.',
  })
  .meta({ id: 'UpdatePromptTemplateRequest' });

export const MemoryListSchema = itemsOf(MemorySchema).meta({ id: 'MemoryList' });
const MemoryTextSchema = z.string().trim().min(1).max(MEMORY_TEXT_MAX);
export const CreateMemoryRequestSchema = z
  .object({ text: MemoryTextSchema })
  .meta({ id: 'CreateMemoryRequest' });
export const UpdateMemoryRequestSchema = z
  .object({ text: MemoryTextSchema.optional(), enabled: z.boolean().optional() })
  .refine((v) => v.text !== undefined || v.enabled !== undefined, {
    message: 'Isi text atau enabled.',
  })
  .meta({ id: 'UpdateMemoryRequest' });

export const UpdateScheduleRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    cron: CronSchema.optional(),
    timezone: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    target: ScheduleTargetSchema.optional(),
    agentRole: RoleIdSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    notify: ScheduleNotifySchema.optional(),
  })
  .meta({ id: 'UpdateScheduleRequest' });

export const ScheduleParseRequestSchema = z
  .object({ text: z.string().min(1), timezone: z.string().min(1).default(DEFAULT_TIMEZONE) })
  .meta({ id: 'ScheduleParseRequest' });

/** Hasil parse bahasa alami. Tidak disimpan sebelum pengguna mengonfirmasi lewat POST /schedules. */
export const ScheduleParseResponseSchema = z
  .object({
    name: z.string().min(1),
    cron: CronSchema,
    timezone: z.string().min(1),
    prompt: z.string().min(1),
    target: ScheduleTargetSchema,
    agentRole: RoleIdSchema.nullable(),
    notify: ScheduleNotifySchema,
    /** Jadwal yang dibaca manusia, mis. "Setiap Senin 07.00 WIB". */
    description: z.string().min(1),
    nextRuns: z.array(TimestampSchema).length(3),
  })
  .meta({ id: 'ScheduleParseResponse' });

/* Riset */

export const CreateResearchRequestSchema = z
  .object({ question: z.string().min(1), depth: ResearchDepthSchema.default('standard') })
  .meta({ id: 'CreateResearchRequest' });

export const ResearchJobDetailSchema = z
  .object({ ...ResearchJobSchema.shape, sources: z.array(ResearchSourceSchema) })
  .meta({ id: 'ResearchJobDetail' });

export const ResearchExportQuerySchema = z.object({ format: z.enum(['md', 'pdf']) });

/* Berkas */

export const FileUploadRequestSchema = z
  .object({ file: z.string().meta({ format: 'binary' }) })
  .meta({ id: 'FileUploadRequest' });

/* Kesehatan */

export const HealthSchema = z.object({ status: z.literal('ok') }).meta({ id: 'Health' });

const CheckSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

export const ReadinessSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    checks: z.object({
      postgres: CheckSchema,
      hermes: CheckSchema,
      ninerouter: CheckSchema,
      searxng: CheckSchema,
    }),
  })
  .meta({ id: 'Readiness' });

export const StatusSchema = z
  .object({
    gateway: z.object({
      version: z.string(),
      /** Versi paket adapter mesin agent (Hermes, omp, relay worker). */
      adaptersVersion: z.string(),
      node: z.string(),
      uptimeSec: z.number().int().nonnegative(),
    }),
    readiness: ReadinessSchema,
    workers: z.array(
      z.object({
        deviceId: IdSchema,
        name: z.string(),
        online: z.boolean(),
        lastSeenAt: TimestampSchema.nullable(),
      }),
    ),
    /** Antrean job (pg-boss): riset dan jadwal. */
    jobs: z.array(
      z.object({
        queue: z.string(),
        queued: z.number().int().nonnegative(),
        active: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      }),
    ),
    /** Run yang belum selesai (di luar menunggu tinjauan). */
    activeRuns: z.number().int().nonnegative(),
  })
  .meta({ id: 'Status' });

/** Batas jumlah output yang dikembalikan `GET /conversations/{id}/progress` (terbaru dulu). */
export const PROGRESS_OUTPUTS_MAX = 50;

const ProgressFileSchema = z.object({
  runId: IdSchema,
  at: TimestampSchema,
  fileId: IdSchema,
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
});

/** Satu hasil kerja agent di percakapan: gambar, berkas, ringkasan perubahan kode, atau laporan riset. */
export const ProgressOutputSchema = z
  .discriminatedUnion('kind', [
    ProgressFileSchema.extend({ kind: z.literal('image') }),
    ProgressFileSchema.extend({ kind: z.literal('file') }),
    z.object({
      kind: z.literal('diff'),
      runId: IdSchema,
      at: TimestampSchema,
      files: z.array(DiffFileSchema).max(500),
    }),
    z.object({
      kind: z.literal('research'),
      runId: IdSchema,
      at: TimestampSchema,
      researchId: IdSchema,
      title: z.string().max(300),
    }),
  ])
  .meta({ id: 'ProgressOutput' });
export type ProgressOutput = z.infer<typeof ProgressOutputSchema>;

/**
 * Agregat panel Progres satu percakapan, dibangun dari event run yang tersimpan sehingga tahan muat ulang:
 * `plan` = todo.updated terakhir dari run terakhir yang punya rencana; `outputs` = hasil kerja, terbaru dulu;
 * `used` = gabungan context.used semua run ditambah alat unik dari tool.started. Tanpa isi memori atau lampiran.
 */
export const ConversationProgressSchema = z
  .object({
    plan: z.object({ runId: IdSchema, phases: z.array(TodoPhaseSchema) }).nullable(),
    outputs: z.array(ProgressOutputSchema).max(PROGRESS_OUTPUTS_MAX),
    used: z.object({
      skills: z.array(z.string()),
      /** Skill yang benar-benar dibuka agent (omp `read skill://`); kosong/absen bila tidak teramati. */
      openedSkills: z.array(z.string()).optional(),
      /** Skill yang ditempel utuh (inti, milik agent, pilihan manual). Absen pada data lama. */
      pinnedSkills: z.array(z.string()).optional(),
      engine: z.string().nullable(),
      model: z.string().nullable(),
      memory: z.object({
        read: z.number().int().nonnegative(),
        items: z.array(z.object({ id: IdSchema, title: z.string() })),
      }),
      attachments: z.array(z.object({ fileId: IdSchema, name: z.string(), mime: z.string() })),
      /** Nama tool unik dari tool.started (urutan pertama muncul); jenisnya dihitung klien. */
      tools: z.array(z.string()),
    }),
  })
  .meta({ id: 'ConversationProgress' });
export type ConversationProgress = z.infer<typeof ConversationProgressSchema>;
