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
    /** Versi omp yang ditemukan di PC ini; null bila tidak terpasang. */
    ompVersion: z.string().nullable().default(null),
    /** Edge/Chrome ditemukan untuk tool browser agent dan tangkapan elemen. */
    browserAvailable: z.boolean().default(false),
  })
  .meta({ id: 'WorkerStatus' });
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

export const GitInfoSchema = z.object({
  isRepo: z.boolean(),
  /** Cabang bawaan (origin/HEAD, atau cabang saat ini bila tanpa remote); null bila bukan repo. */
  defaultBranch: z.string().nullable(),
  currentBranch: z.string().nullable(),
  /** Branch lokal (refs/heads), maks 200; kosong bila bukan repo. */
  branches: z.array(z.string()),
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

const TerminalSize = {
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(200),
};

/** Terminal yang terbuka. Satu per project (atau per worktree run); membuka lagi mengembalikan yang sama beserta riwayat keluarannya. */
export const TerminalInfoSchema = z
  .object({
    id: z.string().min(1),
    cwd: z.string(),
    shell: z.string(),
    /** Keluaran terakhir (maks. 64 KB) supaya tab yang dibuka ulang tidak kosong. */
    replay: z.string(),
    /** Kode keluar bila shell sudah berhenti; null selama masih berjalan. */
    exitCode: z.number().int().nullable(),
  })
  .meta({ id: 'TerminalInfo' });
export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;

export const MAX_TERMINAL_WRITE = 64 * 1024;

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
    method: z.literal('terminal.open'),
    params: PreviewTargetSchema.extend(TerminalSize),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('terminal.write'),
    params: z.object({ terminalId: z.string().min(1), data: z.string().max(MAX_TERMINAL_WRITE) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('terminal.resize'),
    params: z.object({ terminalId: z.string().min(1), ...TerminalSize }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('terminal.close'),
    params: z.object({ terminalId: z.string().min(1) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('files.list'),
    /** `path` relatif terhadap folder project (atau worktree run); kosong = akar. */
    params: PreviewTargetSchema.extend({ path: z.string().max(1024).default('') }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('files.read'),
    params: PreviewTargetSchema.extend({ path: z.string().min(1).max(1024) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('files.find'),
    params: PreviewTargetSchema.extend({ query: z.string().trim().min(1).max(200) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.status'),
    params: PreviewTargetSchema,
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.diff'),
    params: PreviewTargetSchema.extend({ path: z.string().min(1).max(1024) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.log'),
    params: PreviewTargetSchema.extend({ limit: z.number().int().min(1).max(50).default(20) }),
  }),
  /*
   * Aksi git: hanya untuk folder project (bukan worktree run), tidak pernah force. Galat git dikembalikan sebagai
   * `git_failed` dengan pesan git yang sudah dibersihkan dari kredensial.
   */
  z.object({
    id: z.string().min(1),
    method: z.literal('git.stage'),
    /** `all` men-stage semua perubahan; bila tidak, hanya `paths`. */
    params: z.object({
      projectId: IdSchema,
      paths: z.array(z.string().min(1).max(1024)).max(300).default([]),
      all: z.boolean().default(false),
    }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.unstage'),
    params: z.object({
      projectId: IdSchema,
      paths: z.array(z.string().min(1).max(1024)).max(300).default([]),
      all: z.boolean().default(false),
    }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.discard'),
    /** Membuang perubahan satu berkas (berkas baru yang belum dilacak dihapus). Tidak bisa dibatalkan. */
    params: z.object({ projectId: IdSchema, path: z.string().min(1).max(1024) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.commit'),
    params: z.object({ projectId: IdSchema, message: z.string().trim().min(1).max(2000) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.branches'),
    params: z.object({ projectId: IdSchema }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.checkout'),
    /** Hanya ke branch lokal yang sudah ada. */
    params: z.object({ projectId: IdSchema, branch: z.string().min(1).max(255) }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.pull'),
    /** `git pull --ff-only`. */
    params: z.object({ projectId: IdSchema }),
  }),
  z.object({
    id: z.string().min(1),
    method: z.literal('git.push'),
    /** Push branch saat ini ke upstream-nya (tanpa upstream: ke origin dengan -u). Tanpa force. */
    params: z.object({ projectId: IdSchema }),
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
  'terminal_unavailable',
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

/** Berkas atau folder di dalam folder project; `path` memakai `/` dan relatif terhadap akar. */
export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['dir', 'file']),
  size: z.number().int().nonnegative(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;
export const FileListSchema = z.object({
  path: z.string(),
  entries: z.array(FileEntrySchema),
  /** Folder punya lebih banyak isi daripada yang ditampilkan. */
  truncated: z.boolean(),
});
export type FileList = z.infer<typeof FileListSchema>;

/** Isi berkas: teks (UTF-8), gambar (base64), atau tidak bisa ditampilkan (biner, terlalu besar). */
export const FileContentSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  kind: z.enum(['text', 'image', 'binary', 'too_large']),
  mime: z.string(),
  content: z.string(),
  /** Teks dipotong karena terlalu besar. */
  truncated: z.boolean(),
});
export type FileContent = z.infer<typeof FileContentSchema>;
export const FileMatchesSchema = z.object({ paths: z.array(z.string()) });

/** Satu berkas yang berubah menurut `git status`. */
export const GitFileSchema = z.object({
  path: z.string(),
  /** Path lama bila berkas diganti nama. */
  oldPath: z.string().optional(),
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted']),
  /** Ada perubahan yang sudah di-stage / belum di-stage. */
  staged: z.boolean(),
  unstaged: z.boolean(),
});
export type GitFile = z.infer<typeof GitFileSchema>;
export const MAX_GIT_FILES = 300;
export const GitStatusSchema = z.object({
  isRepo: z.boolean(),
  /** Branch saat ini; null bila HEAD lepas atau bukan repo. */
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  files: z.array(GitFileSchema),
  /** Berkas yang berubah lebih banyak daripada batas (300). */
  truncated: z.boolean(),
});
export type GitStatus = z.infer<typeof GitStatusSchema>;
/** Perubahan satu berkas terhadap HEAD (unified diff). Biner tidak dikirim isinya. */
export const GitDiffSchema = z.object({
  path: z.string(),
  patch: z.string(),
  binary: z.boolean(),
  /** Patch dipotong karena terlalu besar. */
  truncated: z.boolean(),
});
export type GitDiff = z.infer<typeof GitDiffSchema>;
export const GitCommitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  subject: z.string(),
  author: z.string(),
  /** ISO 8601. */
  date: z.string(),
});
export type GitCommit = z.infer<typeof GitCommitSchema>;
export const GitLogSchema = z.object({ commits: z.array(GitCommitSchema) });
export type GitLog = z.infer<typeof GitLogSchema>;

/** Hasil aksi git: ringkasan keluaran git (dipotong). */
export const GitActionResultSchema = z.object({ message: z.string() });
export type GitActionResult = z.infer<typeof GitActionResultSchema>;
export const GitBranchesSchema = z.object({
  current: z.string().nullable(),
  branches: z.array(z.string()),
});
export type GitBranches = z.infer<typeof GitBranchesSchema>;

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
  z.object({ push: z.literal('terminal.data'), terminalId: z.string(), data: z.string() }),
  z.object({
    push: z.literal('terminal.exit'),
    terminalId: z.string(),
    exitCode: z.number().int().nullable(),
  }),
]);
export type LocalPush = z.infer<typeof LocalPushSchema>;
