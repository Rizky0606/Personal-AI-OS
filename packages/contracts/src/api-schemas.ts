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
  RunWorkspaceSchema,
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
  MemoryRecallModeSchema,
  MemoryRecallViaSchema,
  QueueNameSchema,
  QuestionAnswerSchema,
  RunEventSchema,
  TeamStatusSchema,
  TodoPhaseSchema,
} from './events.js';
import { MergeSkippedSchema, ReviewCommentSchema } from './worker.js';
import { RichAnswerFollowUpSchema } from './rich-answers.js';
import {
  CONNECTOR_TOKEN_MAX,
  CONNECTOR_TOOL_NAME_MAX,
  CONNECTOR_TOOLS_MAX,
  CONNECTOR_URL_MAX,
  ConnectorNameSchema,
} from './connectors.js';

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

/** Sumber skill yang disimpan di database gateway (skill bawaan repo tetap dari berkas). */
export const SkillUserSourceSchema = z.enum(['user', 'installed', 'agent']);
export const SkillTrustSchema = z.enum(['official', 'trusted', 'community']);
export const SkillStatusSchema = z.enum(['active', 'disabled', 'archived']);
export const SkillEngineSchema = z.enum(['hermes', 'omp', 'dsh']);
export type SkillTrust = z.infer<typeof SkillTrustSchema>;
export type SkillStatus = z.infer<typeof SkillStatusSchema>;
export type SkillEngine = z.infer<typeof SkillEngineSchema>;
export const SKILL_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const SKILL_BODY_MAX_BYTES = 64 * 1024;

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
    /** P10 (halaman Skill). Absen pada klien/data lama; skill bawaan: official, active, semua mesin. */
    trust: SkillTrustSchema.optional(),
    status: SkillStatusSchema.optional(),
    engines: z.array(SkillEngineSchema).optional(),
    pinned: z.boolean().optional(),
    /** false untuk skill bawaan repo: isinya tidak bisa diubah dari UI (hanya dinonaktifkan). */
    editable: z.boolean().optional(),
    /** Asal pemasangan (URL atau id skills.sh) bila dipasang dari luar. */
    origin: z.string().nullable().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    /** Kurator (P11): sejak kapan skill ditandai usang (tidak dibuka 30 hari); null/absen = tidak usang. */
    staleSince: z.string().nullable().optional(),
  })
  .meta({ id: 'SkillSummary' });
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
export const SkillListSchema = itemsOf(SkillSummarySchema).meta({ id: 'SkillList' });

/** `GET /skills/:id`: indeks + isi lengkap (dipakai klien yang menampilkan isi, dan dasar sinkron ke Hermes). */
export const SkillDetailSchema = SkillSummarySchema.extend({ body: z.string() }).meta({
  id: 'SkillDetail',
});
export type SkillDetail = z.infer<typeof SkillDetailSchema>;

/** Hasil pemindai aturan (tanpa model): aman, peringatan (butuh konfirmasi), atau berbahaya (diblokir). */
export const SkillScanFindingSchema = z.object({
  rule: z.string(),
  severity: z.enum(['warning', 'danger']),
  /** Nomor baris (mulai 1) di isi skill; 0 bila berlaku untuk seluruh isi. */
  line: z.number().int().nonnegative(),
  excerpt: z.string(),
  message: z.string(),
});
export const SkillScanSchema = z
  .object({
    verdict: z.enum(['safe', 'warning', 'dangerous']),
    findings: z.array(SkillScanFindingSchema),
  })
  .meta({ id: 'SkillScan' });
export type SkillScan = z.infer<typeof SkillScanSchema>;

const SkillTextFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(200),
  body: z.string().min(1),
};
export const CreateSkillRequestSchema = z
  .object({
    /** Dibuat dari nama bila kosong. */
    id: z.string().regex(SKILL_ID_PATTERN).optional(),
    ...SkillTextFields,
    engines: z.array(SkillEngineSchema).min(1).optional(),
    pinned: z.boolean().optional(),
    /** Setuju melanjutkan walau pemindai memberi peringatan. */
    acknowledge: z.boolean().optional(),
  })
  .meta({ id: 'CreateSkillRequest' });
export const UpdateSkillRequestSchema = z
  .object({
    name: SkillTextFields.name.optional(),
    description: SkillTextFields.description.optional(),
    body: SkillTextFields.body.optional(),
    engines: z.array(SkillEngineSchema).min(1).optional(),
    pinned: z.boolean().optional(),
    trust: z.enum(['trusted', 'community']).optional(),
    acknowledge: z.boolean().optional(),
  })
  .meta({ id: 'UpdateSkillRequest' });
export const ScanSkillRequestSchema = z
  .object({ body: z.string(), description: z.string().optional() })
  .meta({ id: 'ScanSkillRequest' });
export const SetSkillStatusRequestSchema = z
  .object({ status: SkillStatusSchema })
  .meta({ id: 'SetSkillStatusRequest' });
export const RestoreSkillRequestSchema = z
  .object({ version: z.number().int().positive() })
  .meta({ id: 'RestoreSkillRequest' });

/** Hasil simpan: skill + hasil pemindai + status sinkron ke folder skill Hermes (`off` bila tidak dikonfigurasi). */
export const SkillSaveResultSchema = SkillDetailSchema.extend({
  scan: SkillScanSchema,
  hermesSync: z.enum(['off', 'ok', 'failed']),
}).meta({ id: 'SkillSaveResult' });
export type SkillSaveResult = z.infer<typeof SkillSaveResultSchema>;

export const SkillVersionSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string(),
    description: z.string(),
    body: z.string(),
    /** Siapa/apa yang mengubah: user, agent, import, atau restore:v<N>. */
    changedBy: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: 'SkillVersion' });
export const SkillVersionListSchema = itemsOf(SkillVersionSchema).meta({ id: 'SkillVersionList' });

/* Pasang dari luar dan impor dari Hermes (P10). Hanya gateway yang mengunduh; klien hanya mengirim sumbernya. */

/** id skills.sh (pemilik/repo@skill), URL skills.sh, atau URL GitHub ke folder/berkas SKILL.md. */
export const PreviewSkillInstallRequestSchema = z
  .object({ source: z.string().trim().min(1).max(500) })
  .meta({ id: 'PreviewSkillInstallRequest' });
export const SkillInstallPreviewSchema = z
  .object({
    source: z.object({
      kind: z.enum(['skills.sh', 'github', 'raw', 'aitmpl']),
      input: z.string(),
      /** URL SKILL.md yang benar-benar diunduh. */
      url: z.string(),
    }),
    candidate: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().max(200),
      body: z.string(),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
      /** Deskripsi asal >200 karakter dan dipotong. */
      descriptionTrimmed: z.boolean(),
      /** Isi merujuk skrip/berkas eksekusi: TIDAK diunduh dan tidak pernah dijalankan. */
      mentionsScripts: z.boolean(),
    }),
    scan: SkillScanSchema,
    /** Versi terpasang dengan id yang sama (untuk diff); null bila skill baru. */
    existing: z
      .object({
        id: z.string(),
        version: z.string(),
        source: SkillSourceSchema,
        body: z.string(),
      })
      .nullable(),
    /** install = baru; update = memperbarui skill terpasang dari sumber ini; conflict = id dipakai skill lain. */
    action: z.enum(['install', 'update', 'conflict']),
    installable: z.boolean(),
    reason: z.string().optional(),
  })
  .meta({ id: 'SkillInstallPreview' });
export type SkillInstallPreview = z.infer<typeof SkillInstallPreviewSchema>;
export const InstallSkillRequestSchema = z
  .object({
    source: z.string().trim().min(1).max(500),
    /** Checksum isi yang dilihat pengguna di pratinjau; ditolak 409 bila isi di sumber sudah berubah. */
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    acknowledge: z.boolean().optional(),
  })
  .meta({ id: 'InstallSkillRequest' });

export const HermesSkillSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    /** Sudah ada di katalog sebagai skill terpasang dari Hermes. */
    imported: z.boolean(),
    /** Isi bisa dibaca dari folder skill Hermes sehingga bisa diimpor. */
    importable: z.boolean(),
  })
  .meta({ id: 'HermesSkill' });
export const HermesSkillListSchema = z
  .object({
    items: z.array(HermesSkillSchema),
    /** api = dari GET /v1/skills Hermes; folder = dibaca dari folder skill Hermes; none = tidak ada sumber. */
    via: z.enum(['api', 'folder', 'none']),
    note: z.string().optional(),
  })
  .meta({ id: 'HermesSkillList' });
export const PreviewHermesSkillRequestSchema = z
  .object({ name: z.string().min(1).max(200) })
  .meta({ id: 'PreviewHermesSkillRequest' });
/** Pratinjau impor Hermes: isi lengkap + hasil pemindai, supaya persetujuan (acknowledge) diberikan dengan melihat isinya. */
export const HermesSkillPreviewSchema = z
  .object({
    candidate: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      body: z.string(),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
      mentionsScripts: z.boolean(),
    }),
    scan: SkillScanSchema,
    /** Versi terpasang dengan id yang sama (untuk diff); null bila skill baru. */
    existing: z
      .object({ id: z.string(), version: z.string(), source: SkillSourceSchema, body: z.string() })
      .nullable(),
    action: z.enum(['install', 'update', 'conflict']),
    /** false bila tidak bisa diimpor sama sekali (bentrok id, isi membawa frontmatter kedua). */
    importable: z.boolean(),
    reason: z.string().optional(),
    /** Pemindai memberi peringatan/bahaya: impor butuh `acknowledge` setelah pengguna melihat temuan. */
    needsAcknowledge: z.boolean(),
  })
  .meta({ id: 'HermesSkillPreview' });
export type HermesSkillPreview = z.infer<typeof HermesSkillPreviewSchema>;
export const ImportHermesSkillRequestSchema = z
  .object({ name: z.string().min(1).max(200), acknowledge: z.boolean().optional() })
  .meta({ id: 'ImportHermesSkillRequest' });

/* Usulan skill dari agent/Hermes dan kurator mingguan (P11). Hanya tambahan. */

/** Pagar blok usulan di jawaban agent; gateway mengurainya lalu membuang blok dari teks yang ditampilkan. */
export const SKILL_PROPOSAL_FENCE = 'aios-skill-proposal';
export const SKILL_PROPOSAL_LIMITS = { reasonMax: 500, perDay: 3 } as const;
export const SkillProposalKindSchema = z.enum(['new', 'patch']);
export const SkillProposalOriginSchema = z.enum(['agent', 'hermes']);
export const SkillProposalStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type SkillProposalKind = z.infer<typeof SkillProposalKindSchema>;
export type SkillProposalStatus = z.infer<typeof SkillProposalStatusSchema>;

/** Isi blok `aios-skill-proposal` yang ditulis agent. Kunci tak dikenal diabaikan, bukan menggagalkan blok. */
export const SkillProposalBlockSchema = z
  .object({
    kind: SkillProposalKindSchema,
    targetId: z.string().regex(SKILL_ID_PATTERN).optional(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(200),
    body: z
      .string()
      .min(1)
      .refine((v) => new TextEncoder().encode(v).length <= SKILL_BODY_MAX_BYTES, {
        message: 'isi skill melebihi batas ukuran',
      }),
    reason: z.string().trim().min(1).max(SKILL_PROPOSAL_LIMITS.reasonMax),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'patch' && !value.targetId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetId'],
        message: 'usulan patch wajib punya targetId',
      });
    }
  })
  .meta({ id: 'SkillProposalBlock' });
export type SkillProposalBlock = z.infer<typeof SkillProposalBlockSchema>;

/** Usulan tanpa isi (daftar): isi lengkap ada di detail. */
export const SkillProposalSchema = z
  .object({
    id: IdSchema,
    kind: SkillProposalKindSchema,
    origin: SkillProposalOriginSchema,
    /** Skill yang ditambal (kind = patch); null untuk skill baru. */
    targetId: z.string().nullable(),
    /** Nama skill di folder Hermes (origin = hermes); null untuk usulan agent. */
    hermesName: z.string().nullable(),
    name: z.string(),
    description: z.string(),
    reason: z.string(),
    status: SkillProposalStatusSchema,
    /** Hasil pemindai saat usulan disimpan; detail menghitung ulang saat dibuka. */
    scan: SkillScanSchema,
    conversationId: IdSchema.nullable(),
    runId: IdSchema.nullable(),
    messageId: IdSchema.nullable(),
    createdAt: z.string(),
    decidedAt: z.string().nullable(),
    decisionNote: z.string().nullable(),
    /** Skill yang dihasilkan setelah disetujui. */
    resultSkillId: z.string().nullable(),
  })
  .meta({ id: 'SkillProposal' });
export type SkillProposal = z.infer<typeof SkillProposalSchema>;
export const SkillProposalListSchema = itemsOf(SkillProposalSchema).meta({
  id: 'SkillProposalList',
});

/** Detail: isi lengkap, pemindai yang dihitung ulang, dan skill aktif yang ditambal (untuk diff). */
export const SkillProposalDetailSchema = SkillProposalSchema.extend({
  body: z.string(),
  existing: z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      version: z.string(),
      source: SkillSourceSchema,
      body: z.string(),
    })
    .nullable(),
  /** false bila tidak bisa disetujui apa pun suntingannya (mis. target hilang atau bawaan repo). */
  approvable: z.boolean(),
  blockedReason: z.string().optional(),
}).meta({ id: 'SkillProposalDetail' });
export type SkillProposalDetail = z.infer<typeof SkillProposalDetailSchema>;

/** Setujui; field isi bersifat opsional untuk "Edit lalu setujui". Tidak ada jalur lain yang mengaktifkan usulan. */
export const ApproveSkillProposalRequestSchema = z
  .object({
    name: SkillTextFields.name.optional(),
    description: SkillTextFields.description.optional(),
    body: SkillTextFields.body.optional(),
    acknowledge: z.boolean().optional(),
  })
  .meta({ id: 'ApproveSkillProposalRequest' });
export const RejectSkillProposalRequestSchema = z
  .object({ reason: z.string().trim().max(SKILL_PROPOSAL_LIMITS.reasonMax).optional() })
  .meta({ id: 'RejectSkillProposalRequest' });

const CuratorSkillRef = z.object({ id: z.string(), name: z.string() });
export const SkillCuratorReportSchema = z
  .object({
    id: IdSchema,
    generatedAt: z.string(),
    windowDays: z.number().int().positive(),
    /** Paling sering dibuka dalam `windowDays` terakhir. */
    mostUsed: z.array(CuratorSkillRef.extend({ opens: z.number().int().positive() })),
    /** Skill buatan/terpasang/usulan yang belum pernah dibuka (deskripsi mungkin kurang jelas). */
    neverOpened: z.array(CuratorSkillRef),
    /** Usulan yang masih menunggu keputusan. */
    pendingProposals: z.number().int().nonnegative(),
    /** Baru ditandai usang pada run ini (tidak dibuka 30 hari). */
    markedStale: z.array(CuratorSkillRef.extend({ days: z.number().int().nonnegative() })),
    /** Baru diarsipkan pada run ini (skill agent, 90 hari); bisa dipulihkan, tidak pernah dihapus. */
    archived: z.array(CuratorSkillRef.extend({ days: z.number().int().nonnegative() })),
    /** Saran gabung (deskripsi sangat mirip); tidak pernah digabung otomatis. */
    mergeSuggestions: z.array(
      z.object({ a: CuratorSkillRef, b: CuratorSkillRef, similarity: z.number().min(0).max(1) }),
    ),
    summary: z.string(),
  })
  .meta({ id: 'SkillCuratorReport' });
export type SkillCuratorReport = z.infer<typeof SkillCuratorReportSchema>;
export const SkillCuratorReportResponseSchema = z
  .object({ report: SkillCuratorReportSchema.nullable() })
  .meta({ id: 'SkillCuratorReportResponse' });

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
    /**
     * Run coding: tempat run ini mengubah berkas, menimpa setelan project di worker untuk pesan ini saja (mis.
     * "jalankan sekali ini di worktree terpisah" saat folder project kotor). Kosong = setelan project (bawaan
     * `in_place`). `in_place` ditolak 422 `workspace_not_allowed` di percakapan tim. Pesan lanjutan yang
     * melanjutkan hasil yang belum ditinjau memakai mode run itu; pilihan lain ditolak 409 `review_pending`.
     */
    workspace: RunWorkspaceSchema.optional(),
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
  .object({ text: MemoryTextSchema, pinned: z.boolean().optional() })
  .meta({ id: 'CreateMemoryRequest' });
export const UpdateMemoryRequestSchema = z
  .object({
    text: MemoryTextSchema.optional(),
    enabled: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => v.text !== undefined || v.enabled !== undefined || v.pinned !== undefined, {
    message: 'Isi text, enabled, atau pinned.',
  })
  .meta({ id: 'UpdateMemoryRequest' });

/** Batas usulan memori dari ekstraksi fakta (docs/DESIGN_MEMORI_SEMANTIK.md 4.1). */
export const MEMORY_PROPOSAL_LIMITS = { textMax: 300, evidenceMax: 200 } as const;

/** `add` = fakta baru; `update` = mengganti teks memori yang sudah ada (`targetMemoryId`). */
export const MemoryProposalKindSchema = z.enum(['add', 'update']);
/**
 * `pending` menunggu keputusan (mode propose); `approved`/`rejected` keputusan pemilik; `auto_saved` langsung disimpan
 * (mode auto) dan masih bisa diurungkan; `undone` sudah diurungkan.
 */
export const MemoryProposalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'auto_saved',
  'undone',
]);
export type MemoryProposalKind = z.infer<typeof MemoryProposalKindSchema>;
export type MemoryProposalStatus = z.infer<typeof MemoryProposalStatusSchema>;

/** Mesin agent yang membuat usulan lewat tool `aios_tools` (docs/DESIGN_MCP_TOOLS.md bagian 17). */
export const ProposalAgentSchema = z.enum(['omp', 'hermes']);
export type ProposalAgent = z.infer<typeof ProposalAgentSchema>;
/** `extraction` = ekstraksi fakta setelah chat umum; `agent` = tool `memory_propose`. */
export const MemoryProposalSourceSchema = z.enum(['extraction', 'agent']);
export type MemoryProposalSource = z.infer<typeof MemoryProposalSourceSchema>;

/** Usulan memori dari ekstraksi fakta: fakta tentang pemilik plus kutipan pesan pemilik yang menjadi dasarnya. */
export const MemoryProposalSchema = z
  .object({
    id: IdSchema,
    kind: MemoryProposalKindSchema,
    status: MemoryProposalStatusSchema,
    text: z.string().min(1).max(MEMORY_TEXT_MAX),
    /** Kutipan apa adanya dari pesan pemilik; dijamin muncul di pesan itu. */
    evidence: z.string().max(MEMORY_PROPOSAL_LIMITS.evidenceMax),
    /** Memori yang diganti (kind = update); null untuk fakta baru atau bila memori itu sudah dihapus. */
    targetMemoryId: IdSchema.nullable(),
    /** Teks memori target sekarang (kind = update), untuk dibandingkan sebelum disetujui. */
    targetText: z.string().nullable(),
    /** Teks memori target sebelum diganti; terisi setelah usulan update diterapkan (untuk urungkan). */
    previousText: z.string().nullable(),
    /** Memori hasil setelah disetujui atau disimpan otomatis. */
    resultMemoryId: IdSchema.nullable(),
    conversationId: IdSchema.nullable(),
    messageId: IdSchema.nullable(),
    runId: IdSchema.nullable(),
    /** Model pengekstrak, atau model run agent (mesin bila tanpa model). */
    model: z.string(),
    /** Asal usulan: ekstraksi fakta, atau agent lewat tool `memory_propose`. Absen pada server lama = extraction. */
    source: MemoryProposalSourceSchema.default('extraction'),
    /** Mesin agent yang mengusulkan (source = agent). Absen pada server lama = null. */
    agent: ProposalAgentSchema.nullable().default(null),
    /** Agent sudah memakai tool web di run itu sebelum mengusulkan; tampilkan peringatan. Absen = false. */
    afterWeb: z.boolean().default(false),
    createdAt: TimestampSchema,
    decidedAt: TimestampSchema.nullable(),
  })
  .meta({ id: 'MemoryProposal' });
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;
export const MemoryProposalListSchema = itemsOf(MemoryProposalSchema).meta({
  id: 'MemoryProposalList',
});
/** Jendela `status=review`: usulan `auto_saved`/`undone` sebanyak hari ini ikut tampil di blok usulan klien. */
export const MEMORY_PROPOSAL_RECENT_DAYS = 7;
export const MemoryProposalQuerySchema = z.object({
  /**
   * Bawaan `pending`. `review` = semua yang `pending` ditambah `auto_saved` dan `undone` yang dibuat dalam
   * MEMORY_PROPOSAL_RECENT_DAYS hari terakhir (blok usulan di desktop dan Android, termasuk tombol Urungkan).
   */
  status: z.enum([...MemoryProposalStatusSchema.options, 'all', 'review']).optional(),
});
/** Setujui; `text` opsional untuk "Ubah lalu simpan". */
export const ApproveMemoryProposalRequestSchema = z
  .object({ text: MemoryTextSchema.optional() })
  .meta({ id: 'ApproveMemoryProposalRequest' });

/* Usulan kartu dan jadwal dari agent (tool `task_propose`/`schedule_propose`, docs/DESIGN_MCP_TOOLS.md bagian 17) */

/** Alasan singkat agent untuk usulan kartu/jadwal, ditampilkan saat meninjau. */
export const PROPOSAL_REASON_MAX = 300;
export const TASK_PROPOSAL_TITLE_MAX = 200;
export const TASK_PROPOSAL_BODY_MAX = 4000;
export const SCHEDULE_PROPOSAL_NAME_MAX = 120;
export const SCHEDULE_PROPOSAL_PROMPT_MAX = 2000;
/** Target jadwal yang boleh diusulkan agent (role dan briefing hanya dari pemilik). */
export const ProposedScheduleTargetSchema = z.enum(['chat', 'research']);

export const AgentProposalKindSchema = z.enum(['task', 'schedule']);
export type AgentProposalKind = z.infer<typeof AgentProposalKindSchema>;
export const AgentProposalStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type AgentProposalStatus = z.infer<typeof AgentProposalStatusSchema>;

export const ProposedTaskSchema = z
  .object({
    title: z.string().min(1).max(TASK_PROPOSAL_TITLE_MAX),
    body: z.string().max(TASK_PROPOSAL_BODY_MAX),
  })
  .meta({ id: 'ProposedTask' });
export type ProposedTask = z.infer<typeof ProposedTaskSchema>;

export const ProposedScheduleSchema = z
  .object({
    name: z.string().min(1).max(SCHEDULE_PROPOSAL_NAME_MAX),
    cron: CronSchema,
    timezone: z.string().min(1),
    prompt: z.string().min(1).max(SCHEDULE_PROPOSAL_PROMPT_MAX),
    target: ProposedScheduleTargetSchema,
  })
  .meta({ id: 'ProposedSchedule' });
export type ProposedSchedule = z.infer<typeof ProposedScheduleSchema>;

const AgentProposalBase = {
  id: IdSchema,
  status: AgentProposalStatusSchema,
  agent: ProposalAgentSchema,
  /** Alasan agent; data dari agent, bukan perintah. */
  reason: z.string(),
  /** Agent sudah memakai tool web di run itu sebelum mengusulkan; tampilkan peringatan. */
  afterWeb: z.boolean(),
  /** Project kartu (kind = task); null untuk jadwal. */
  projectId: IdSchema.nullable(),
  conversationId: IdSchema.nullable(),
  runId: IdSchema.nullable(),
  /** Kartu atau jadwal yang dibuat setelah disetujui. */
  resultId: IdSchema.nullable(),
  createdAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
};

/** Usulan agent yang belum mengubah apa pun sampai pemilik menyetujuinya. */
export const AgentProposalSchema = z
  .discriminatedUnion('kind', [
    z.object({ ...AgentProposalBase, kind: z.literal('task'), task: ProposedTaskSchema }),
    z.object({
      ...AgentProposalBase,
      kind: z.literal('schedule'),
      schedule: ProposedScheduleSchema,
      /** Jadwal yang dibaca manusia, mis. "Setiap Senin 07.00 WIB". */
      description: z.string(),
    }),
  ])
  .meta({ id: 'AgentProposal' });
export type AgentProposal = z.infer<typeof AgentProposalSchema>;
export const AgentProposalListSchema = itemsOf(AgentProposalSchema).meta({
  id: 'AgentProposalList',
});
export const AgentProposalQuerySchema = z.object({
  status: z.enum([...AgentProposalStatusSchema.options, 'all']).optional(),
  kind: AgentProposalKindSchema.optional(),
  projectId: IdSchema.optional(),
  /** Menyaring usulan yang lahir dari satu percakapan (kartu usulan di chat). */
  conversationId: IdSchema.optional(),
});
/**
 * Setujui, opsional dengan ubahan pemilik. Field `task`/`schedule` hanya untuk jenis yang sesuai; `enabled` (jadwal)
 * bawaan true: menyetujui berarti jadwal mulai berjalan, kecuali pemilik memilih nonaktif.
 */
export const ApproveAgentProposalRequestSchema = z
  .object({
    task: z
      .object({
        title: z.string().trim().min(1).max(TASK_PROPOSAL_TITLE_MAX).optional(),
        body: z.string().trim().max(TASK_PROPOSAL_BODY_MAX).optional(),
      })
      .strict()
      .optional(),
    schedule: z
      .object({
        name: z.string().trim().min(1).max(SCHEDULE_PROPOSAL_NAME_MAX).optional(),
        cron: CronSchema.optional(),
        timezone: z.string().trim().min(1).optional(),
        prompt: z.string().trim().min(1).max(SCHEDULE_PROPOSAL_PROMPT_MAX).optional(),
        target: ProposedScheduleTargetSchema.optional(),
        enabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .meta({ id: 'ApproveAgentProposalRequest' });

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
    /**
     * Tool aplikasi (`aios_tools`) untuk agent. `mcp`: server MCP gateway menyala (MCP_TOOLS_ENABLED). `hermes`:
     * principal Hermes dikonfigurasi (MCP_HERMES_TOKEN_SHA256, docs/RUNBOOK_HERMES_MCP.md); bila false, chat umum
     * tidak bisa mengusulkan memori atau jadwal sendiri, pemilik memakai tombol Ingat dan layar Jadwal.
     */
    agentTools: z.object({ mcp: z.boolean(), hermes: z.boolean() }),
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
    /** Usulan skill dari agent di percakapan ini (P11); klien lama mengabaikan jenis yang tak dikenal. */
    z.object({
      kind: z.literal('skill_proposal'),
      runId: IdSchema,
      at: TimestampSchema,
      proposalId: IdSchema,
      name: z.string().max(80),
      proposalKind: SkillProposalKindSchema,
      status: SkillProposalStatusSchema,
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
        /** Fakta yang benar-benar disuntik pada run terbaru. */
        read: z.number().int().nonnegative(),
        /** Jumlah memori aktif saat itu; absen pada data lama. */
        total: z.number().int().nonnegative().optional(),
        mode: MemoryRecallModeSchema.optional(),
        items: z.array(
          z.object({ id: IdSchema, title: z.string(), via: MemoryRecallViaSchema.optional() }),
        ),
      }),
      attachments: z.array(z.object({ fileId: IdSchema, name: z.string(), mime: z.string() })),
      /** Nama tool unik dari tool.started (urutan pertama muncul); jenisnya dihitung klien. */
      tools: z.array(z.string()),
    }),
  })
  .meta({ id: 'ConversationProgress' });
export type ConversationProgress = z.infer<typeof ConversationProgressSchema>;

/*
 * Konektor MCP pihak ketiga (docs/DESIGN_MCP_KONEKTOR.md). Token konektor TIDAK PERNAH ikut di respons
 * mana pun: yang terlihat hanya `hasToken`. Permintaan buat/ubah menerimanya sebagai field tulis-saja.
 */

/** Satu tool di server konektor, seperti yang terbaca saat `probe` dan disetujui pemilik. */
export const McpConnectorToolSchema = z
  .object({
    name: z.string().trim().min(1).max(CONNECTOR_TOOL_NAME_MAX),
    /** Judul manusiawi dari server, bila ada. */
    title: z.string().max(200).optional(),
    description: z.string().max(2000),
    /** JSON Schema masukan dari server, diteruskan apa adanya ke mesin agent. */
    inputSchema: z.record(z.string(), z.unknown()),
    /** `annotations.readOnlyHint === true`. Hint yang hilang dianggap menulis. */
    readOnly: z.boolean(),
  })
  .meta({ id: 'McpConnectorTool' });
export type McpConnectorTool = z.infer<typeof McpConnectorToolSchema>;

export const McpConnectorSchema = z
  .object({
    id: IdSchema,
    /** Slug yang ikut ke nama tool di mesin agent (`mcp__konektor_<name>_<tool>`). */
    name: ConnectorNameSchema,
    displayName: z.string().min(1).max(80),
    url: z.string().max(CONNECTOR_URL_MAX),
    /** Token statis tersimpan (nilainya tidak pernah dikembalikan). */
    hasToken: z.boolean(),
    enabled: z.boolean(),
    /** Tool yang diizinkan pemilik; hanya ini yang dilihat agent. */
    tools: z.array(McpConnectorToolSchema),
    lastProbeAt: TimestampSchema.nullable(),
    /** Pesan kegagalan terakhir (sudah dibersihkan dari rahasia); null bila sehat. */
    lastError: z.string().nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: 'McpConnector' });
export type McpConnector = z.infer<typeof McpConnectorSchema>;

export const McpConnectorListSchema = itemsOf(McpConnectorSchema).meta({ id: 'McpConnectorList' });

/** Hasil `initialize` + `tools/list` terhadap server konektor; tidak menyimpan apa pun. */
export const McpConnectorProbeSchema = z
  .object({
    url: z.string(),
    serverName: z.string(),
    serverVersion: z.string(),
    protocolVersion: z.string(),
    tools: z.array(McpConnectorToolSchema),
    /** Server memberi lebih banyak tool daripada batas; sisanya dipotong. */
    truncated: z.boolean(),
  })
  .meta({ id: 'McpConnectorProbe' });
export type McpConnectorProbe = z.infer<typeof McpConnectorProbeSchema>;

const ConnectorUrlSchema = z.string().trim().min(1).max(CONNECTOR_URL_MAX);
const ConnectorTokenSchema = z.string().trim().min(1).max(CONNECTOR_TOKEN_MAX);

/** Pratinjau sebelum menyimpan: URL dan token yang diketik pemilik, atau konektor tersimpan (tanpa body). */
export const ProbeMcpConnectorRequestSchema = z
  .object({ url: ConnectorUrlSchema, token: ConnectorTokenSchema.optional() })
  .meta({ id: 'ProbeMcpConnectorRequest' });

export const CreateMcpConnectorRequestSchema = z
  .object({
    name: ConnectorNameSchema,
    displayName: z.string().trim().min(1).max(80),
    url: ConnectorUrlSchema,
    token: ConnectorTokenSchema.optional(),
    tools: z.array(McpConnectorToolSchema).max(CONNECTOR_TOOLS_MAX),
  })
  .meta({ id: 'CreateMcpConnectorRequest' });

/** Field yang tidak dikirim tidak berubah. `token: null` menghapus token tersimpan. */
export const UpdateMcpConnectorRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    url: ConnectorUrlSchema.optional(),
    token: ConnectorTokenSchema.nullable().optional(),
    tools: z.array(McpConnectorToolSchema).max(CONNECTOR_TOOLS_MAX).optional(),
  })
  .meta({ id: 'UpdateMcpConnectorRequest' });

export const SetMcpConnectorEnabledRequestSchema = z
  .object({ enabled: z.boolean() })
  .meta({ id: 'SetMcpConnectorEnabledRequest' });
