import { z } from 'zod';
import { IdSchema } from './common.js';
import { StackSchema } from './entities.js';

/*
 * Protokol lokal antara aplikasi desktop dan worker sidecar (API_CONTRACT.md, "Protokol worker"):
 * WebSocket di 127.0.0.1, port acak, token sekali pakai dari Tauri. Bukan bagian REST gateway.
 */

export const LOCAL_PROTOCOL_VERSION = 1;

/** Baris pertama yang dicetak worker ke stdout begitu siap menerima koneksi. */
export const WorkerListeningLineSchema = z.object({
  event: z.literal('listening'),
  port: z.number().int().min(1).max(65535),
  version: z.literal(LOCAL_PROTOCOL_VERSION),
});
export type WorkerListeningLine = z.infer<typeof WorkerListeningLineSchema>;

/** Pesan pertama klien. Token dipakai sekali; jawaban `ready` membawa token berikutnya. */
export const LocalHelloSchema = z.object({ type: z.literal('hello'), token: z.string().min(16) });
export const LocalReadySchema = z.object({
  type: z.literal('ready'),
  version: z.literal(LOCAL_PROTOCOL_VERSION),
  nextToken: z.string().min(16),
});

export const GatewayStateSchema = z.enum(['offline', 'connecting', 'connected', 'reconnecting']);
export type GatewayState = z.infer<typeof GatewayStateSchema>;

export const WorkerStatusSchema = z
  .object({
    gateway: GatewayStateSchema,
    /** Perangkat worker di gateway; null sebelum sesi diberikan. */
    deviceId: IdSchema.nullable(),
    activeRuns: z.number().int().nonnegative(),
    version: z.string(),
  })
  .meta({ id: 'WorkerStatus' });
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const GitInfoSchema = z.object({
  isRepo: z.boolean(),
  /** Cabang bawaan (origin/HEAD, atau cabang saat ini bila tanpa remote); null bila bukan repo. */
  defaultBranch: z.string().nullable(),
  currentBranch: z.string().nullable(),
});
export type GitInfo = z.infer<typeof GitInfoSchema>;

export const ProjectInspectionSchema = z
  .object({
    /** Path yang sudah dinormalisasi dan diselesaikan symlink-nya. */
    path: z.string().min(1),
    name: z.string().min(1),
    stack: StackSchema,
    git: GitInfoSchema,
  })
  .meta({ id: 'ProjectInspection' });
export type ProjectInspection = z.infer<typeof ProjectInspectionSchema>;

export const ProjectBindingSchema = z.object({
  projectId: IdSchema,
  path: z.string().min(1),
  /** Folder masih ada dan masih di dalam folder yang diizinkan. */
  available: z.boolean(),
});
export type ProjectBinding = z.infer<typeof ProjectBindingSchema>;

const PathParams = z.object({ path: z.string().min(1) });

/** Yang di-preview: folder project, atau worktree sebuah run bila runId diisi. */
export const PreviewTargetSchema = z.object({ projectId: IdSchema, runId: IdSchema.optional() });
export type PreviewTarget = z.infer<typeof PreviewTargetSchema>;

export const PreviewStatusSchema = z.enum(['starting', 'ready', 'failed', 'stopped']);

/** Keadaan satu preview. `url` adalah alamat untuk iframe (proxy lokal); `devUrl` alamat dev server aslinya. */
export const PreviewInfoSchema = z
  .object({
    key: z.string().min(1),
    projectId: IdSchema,
    runId: IdSchema.nullable(),
    status: PreviewStatusSchema,
    url: z.string().nullable(),
    devUrl: z.string().nullable(),
    /** Perintah yang dijalankan, mis. 'pnpm run dev'. */
    command: z.string().nullable(),
    error: z.string().nullable(),
    /** Ekor keluaran dev server. */
    log: z.string(),
  })
  .meta({ id: 'PreviewInfo' });
export type PreviewInfo = z.infer<typeof PreviewInfoSchema>;

export const PreviewShotSchema = z.object({
  /** PNG, base64. */
  png: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PreviewShot = z.infer<typeof PreviewShotSchema>;

/** Permintaan dari desktop. `id` dikembalikan apa adanya di balasan. */
export const LocalRequestSchema = z.discriminatedUnion('method', [
  z.object({ id: z.string().min(1), method: z.literal('status.get') }),
  z.object({
    id: z.string().min(1),
    method: z.literal('session.set'),
    params: z.object({
      serverUrl: z.url(),
      accessToken: z.string().min(1),
      refreshToken: z.string().min(1),
      deviceId: IdSchema,
    }),
  }),
  z.object({ id: z.string().min(1), method: z.literal('session.clear') }),
  z.object({ id: z.string().min(1), method: z.literal('folders.list') }),
  z.object({ id: z.string().min(1), method: z.literal('folders.add'), params: PathParams }),
  z.object({ id: z.string().min(1), method: z.literal('folders.remove'), params: PathParams }),
  z.object({ id: z.string().min(1), method: z.literal('project.inspect'), params: PathParams }),
  z.object({
    id: z.string().min(1),
    method: z.literal('project.bind'),
    params: z.object({ projectId: IdSchema, path: z.string().min(1) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('project.unbind'),
    params: z.object({ projectId: IdSchema }),
  }),
  z.object({ id: z.string().min(1), method: z.literal('projects.list') }),
  z.object({
    id: z.string().min(1),
    method: z.literal('review.get'),
    params: z.object({ runId: IdSchema }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('review.undo'),
    /** `base` = sebelum langkah pertama agent; selain itu id checkpoint. */
    params: z.object({ runId: IdSchema, checkpointId: z.string().min(1) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('review.revertFile'),
    params: z.object({ runId: IdSchema, path: z.string().min(1) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('preview.start'),
    params: PreviewTargetSchema,
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('preview.get'),
    params: PreviewTargetSchema,
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('preview.stop'),
    params: PreviewTargetSchema,
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('preview.shot'),
    params: PreviewTargetSchema.extend({
      /** Elemen yang ditangkap; kosong = seluruh viewport. */
      selector: z.string().min(1).max(1000).optional(),
      width: z.number().int().min(200).max(2560).optional(),
      height: z.number().int().min(200).max(1600).optional(),
    }),
  }),
]);
export type LocalRequest = z.infer<typeof LocalRequestSchema>;
export type LocalMethod = LocalRequest['method'];

/** Kode galat yang stabil; UI memetakannya ke pesan. */
export const LocalErrorCodeSchema = z.enum([
  'invalid_request',
  'path_not_allowed',
  'path_not_found',
  'not_a_directory',
  'path_too_broad',
  'not_bound',
  'review_not_found',
  'git_failed',
  'run_active',
  'preview_unavailable',
  'internal',
]);
export type LocalErrorCode = z.infer<typeof LocalErrorCodeSchema>;

export const LocalResponseSchema = z.union([
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: LocalErrorCodeSchema, message: z.string() }),
  }),
]);
export type LocalResponse = z.infer<typeof LocalResponseSchema>;

export const ReviewFileSchema = z.object({
  path: z.string().min(1),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  oldPath: z.string().optional(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  /** Unified diff terhadap base ('' untuk biner). */
  patch: z.string(),
  /** Patch dipotong karena terlalu besar. */
  truncated: z.boolean(),
});
export type ReviewFile = z.infer<typeof ReviewFileSchema>;

export const CheckpointSchema = z.object({
  /** SHA commit checkpoint. */
  id: z.string().min(1),
  label: z.string(),
  ts: z.iso.datetime(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const ReviewStateSchema = z
  .object({
    runId: IdSchema,
    /** Branch kerja agent (aios/<id>). */
    branch: z.string(),
    base: z.string(),
    /** Branch kerja pengguna di repo asli saat ini; null bila detached. */
    targetBranch: z.string().nullable(),
    /** Pesan Conventional Commits buatan agent (atau bawaan bila agent tidak menulisnya). */
    commitMessage: z.string(),
    files: z.array(ReviewFileSchema),
    /** Dari yang paling lama; base tidak termasuk. */
    checkpoints: z.array(CheckpointSchema),
  })
  .meta({ id: 'ReviewState' });
export type ReviewState = z.infer<typeof ReviewStateSchema>;

/** Hasil per metode, untuk validasi di sisi desktop. */
export const FoldersResultSchema = z.object({ folders: z.array(z.string()) });
export const ProjectsResultSchema = z.object({ projects: z.array(ProjectBindingSchema) });

/** Dorongan dari worker tanpa permintaan. */
export const LocalPushSchema = z.discriminatedUnion('push', [
  z.object({ push: z.literal('status'), status: WorkerStatusSchema }),
  /** Refresh token dirotasi gateway; desktop wajib menyimpan yang baru ke Credential Manager. */
  z.object({
    push: z.literal('session.updated'),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
  }),
  /** Refresh ditolak (perangkat dicabut atau token terpakai ulang): desktop mendaftarkan worker ulang. */
  z.object({ push: z.literal('session.invalid') }),
  /** Preview berubah keadaan (mulai, siap, gagal, berhenti). */
  z.object({ push: z.literal('preview.state'), preview: PreviewInfoSchema }),
]);
export type LocalPush = z.infer<typeof LocalPushSchema>;
