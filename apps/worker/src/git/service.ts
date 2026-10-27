import {
  MAX_GIT_FILES,
  type GitActionResult,
  type GitBranches,
  type GitCommit,
  type GitDiff,
  type GitFile,
  type GitLog,
  type GitStatus,
  type PreviewTarget,
} from '@aios/contracts';
import { PathError } from '../paths/normalize.js';
import type { ProcessManager } from '../process/manager.js';

const GIT_TIMEOUT_MS = 10_000;
const MAX_STATUS_BYTES = 512 * 1024;
export const MAX_PATCH_BYTES = 256 * 1024;
const MAX_LOG_BYTES = 128 * 1024;

export interface GitDeps {
  /** Folder kerja untuk project atau worktree run (galat bila belum terikat atau worktree hilang). */
  resolve: (target: PreviewTarget) => Promise<{ cwd: string }>;
  processes: ProcessManager;
}

export interface GitService {
  status(target: PreviewTarget): Promise<GitStatus>;
  diff(target: PreviewTarget, path: string): Promise<GitDiff>;
  log(target: PreviewTarget, limit: number): Promise<GitLog>;
  /** Aksi (mengubah repo): hanya folder project, tanpa force. Galat git menjadi GitActionError. */
  stage(projectId: string, paths: string[], all: boolean): Promise<GitActionResult>;
  unstage(projectId: string, paths: string[], all: boolean): Promise<GitActionResult>;
  discard(projectId: string, path: string): Promise<GitActionResult>;
  commit(projectId: string, message: string): Promise<GitCommit>;
  branches(projectId: string): Promise<GitBranches>;
  checkout(projectId: string, branch: string): Promise<GitActionResult>;
  pull(projectId: string): Promise<GitActionResult>;
  push(projectId: string): Promise<GitActionResult>;
}

/** Aksi git yang gagal; pesannya keluaran git yang sudah dibersihkan, aman ditampilkan. Kode: `git_failed`. */
export class GitActionError extends Error {
  readonly code = 'git_failed' as const;
  constructor(message: string) {
    super(message);
    this.name = 'GitActionError';
  }
}

const ACTION_TIMEOUT_MS = 30_000;
/** Commit menjalankan hook, push/pull menunggu jaringan. */
const SLOW_ACTION_TIMEOUT_MS = 90_000;
const MAX_ACTION_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 500;

/** Kredensial di URL (`https://user:token@host`) dibuang dari pesan yang ditampilkan. */
export function scrub(text: string): string {
  return text.replace(/(\w+:\/\/)[^/@\s]+@/g, '$1***@').trim();
}

const summarize = (stdout: string, stderr: string): string => {
  const text = scrub([stdout, stderr].filter((t) => t.trim().length > 0).join('\n'));
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
};

const NOT_A_REPO = 'Folder ini bukan repo git.';

const EMPTY_STATUS: GitStatus = {
  isRepo: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
  truncated: false,
};

/** String kosong dianggap tidak ada. */
const nonEmpty = (value: string | undefined): string | null =>
  value !== undefined && value.length > 0 ? value : null;

/** `## main...origin/main [ahead 1, behind 2]`, `## HEAD (no branch)`, `## No commits yet on main`. */
export function parseBranchLine(
  line: string,
): Pick<GitStatus, 'branch' | 'upstream' | 'ahead' | 'behind'> {
  let text = line.replace(/^## /, '');
  let ahead = 0;
  let behind = 0;
  const counts = /\s\[([^\]]+)\]$/.exec(text);
  if (counts) {
    text = text.slice(0, counts.index);
    ahead = Number(/ahead (\d+)/.exec(counts[1] ?? '')?.[1] ?? 0);
    behind = Number(/behind (\d+)/.exec(counts[1] ?? '')?.[1] ?? 0);
  }
  const noCommits = /^No commits yet on (.+)$/.exec(text);
  if (noCommits) return { branch: noCommits[1] ?? null, upstream: null, ahead, behind };
  if (text.startsWith('HEAD (no branch)')) return { branch: null, upstream: null, ahead, behind };
  const [branch, upstream] = text.split('...');
  return { branch: nonEmpty(branch), upstream: nonEmpty(upstream), ahead, behind };
}

/** Kode XY `git status --porcelain` menjadi satu berkas; null untuk entri yang tidak perlu ditampilkan. */
export function parseEntry(code: string, path: string, oldPath?: string): GitFile | null {
  const x = code.charAt(0);
  const y = code.charAt(1);
  if (code === '??') {
    return { path, status: 'untracked', staged: false, unstaged: true };
  }
  if (code === '!!') return null;
  const conflicted = x === 'U' || y === 'U' || code === 'AA' || code === 'DD';
  const staged = x !== ' ' && x !== '?';
  const unstaged = y !== ' ' && y !== '?';
  const main = y !== ' ' ? y : x;
  const status: GitFile['status'] = conflicted
    ? 'conflicted'
    : main === 'A' || main === 'C'
      ? 'added'
      : main === 'D'
        ? 'deleted'
        : main === 'R'
          ? 'renamed'
          : 'modified';
  return { path, ...(oldPath ? { oldPath } : {}), status, staged, unstaged };
}

/**
 * Status, diff, dan riwayat git untuk tab Git (hanya baca). Semua perintah memakai GIT_OPTIONAL_LOCKS=0
 * supaya tidak menulis indeks (tidak mengganggu git yang dijalankan pengguna atau agent), tanpa prompt
 * kredensial, dan dengan batas waktu dan ukuran keluaran.
 */
export function createGitService({ resolve, processes }: GitDeps): GitService {
  async function git(cwd: string, args: string[], maxBytes: number) {
    return processes.run('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: maxBytes,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
  }

  async function isRepo(cwd: string): Promise<boolean> {
    const r = await git(cwd, ['rev-parse', '--is-inside-work-tree'], 1024);
    return r.code === 0 && !r.spawnError && r.stdout.trim() === 'true';
  }

  /** Perintah yang mengubah repo: tanpa prompt kredensial (juga GUI Git Credential Manager). */
  async function act(cwd: string, args: string[], timeoutMs = ACTION_TIMEOUT_MS, ok = [0]) {
    const r = await processes.run('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      timeoutMs,
      maxOutputBytes: MAX_ACTION_BYTES,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' },
    });
    if (r.spawnError)
      throw new GitActionError('Git tidak bisa dijalankan. Pastikan git terpasang.');
    if (r.timedOut) throw new GitActionError('Git terlalu lama menjawab dan dihentikan.');
    if (r.code === null || !ok.includes(r.code)) {
      throw new GitActionError(summarize(r.stderr, r.stdout) || 'Git gagal tanpa pesan.');
    }
    return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  }

  async function projectRepo(projectId: string): Promise<string> {
    const { cwd } = await resolve({ projectId });
    if (!(await isRepo(cwd))) throw new PathError('invalid_request', NOT_A_REPO);
    return cwd;
  }

  const hasHead = async (cwd: string) =>
    (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'], 1024)).code === 0;

  async function localBranches(cwd: string): Promise<GitBranches> {
    const list = await git(
      cwd,
      [
        'for-each-ref',
        '--count=200',
        '--sort=-committerdate',
        '--format=%(refname:short)',
        'refs/heads',
      ],
      MAX_STATUS_BYTES,
    );
    const current = await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], 1024);
    const name = current.stdout.trim();
    return {
      current: current.code === 0 && name.length > 0 ? name : null,
      branches: list.stdout
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean),
    };
  }

  function safePath(path: string): string {
    const normalized = path.replaceAll('\\', '/');
    if (
      path.includes('\0') ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized.split('/').includes('..') ||
      normalized.startsWith('-')
    ) {
      throw new PathError('path_not_allowed', 'Path harus relatif terhadap folder project.');
    }
    return normalized;
  }

  return {
    async status(target) {
      const { cwd } = await resolve(target);
      if (!(await isRepo(cwd))) return EMPTY_STATUS;
      const r = await git(
        cwd,
        ['status', '--porcelain=v1', '-z', '-b', '--untracked-files=all'],
        MAX_STATUS_BYTES,
      );
      if (r.code !== 0 || r.spawnError) return EMPTY_STATUS;
      const records = r.stdout.split('\0');
      const head = records.shift() ?? '';
      const branch = head.startsWith('## ')
        ? parseBranchLine(head)
        : { branch: null, upstream: null, ahead: 0, behind: 0 };
      const files: GitFile[] = [];
      let truncated = r.truncated;
      for (let i = 0; i < records.length; i++) {
        const record = records[i] ?? '';
        if (record.length < 4) continue;
        const code = record.slice(0, 2);
        const path = record.slice(3);
        // Ganti nama/salin: path lama ada di rekaman berikutnya.
        const renamed = code.includes('R') || code.includes('C');
        const oldPath = renamed ? records[++i] : undefined;
        const entry = parseEntry(code, path, nonEmpty(oldPath) ?? undefined);
        if (!entry) continue;
        if (files.length >= MAX_GIT_FILES) {
          truncated = true;
          break;
        }
        files.push(entry);
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      return { isRepo: true, ...branch, files, truncated };
    },

    async diff(target, path) {
      const { cwd } = await resolve(target);
      const rel = safePath(path);
      if (!(await isRepo(cwd))) throw new PathError('invalid_request', NOT_A_REPO);

      const tracked = (await git(cwd, ['ls-files', '--error-unmatch', '--', rel], 1024)).code === 0;
      const hasHead = (await git(cwd, ['rev-parse', '--verify', '-q', 'HEAD'], 1024)).code === 0;
      const args = !tracked
        ? ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', '/dev/null', rel]
        : hasHead
          ? ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-M', '--', rel]
          : ['diff', '--cached', '--no-color', '--no-ext-diff', '--', rel];
      const r = await git(cwd, args, MAX_PATCH_BYTES);
      // `diff --no-index` keluar dengan kode 1 bila ada perbedaan; itu bukan galat.
      if (r.spawnError || (r.code !== 0 && r.code !== 1)) {
        throw new PathError('path_not_found', 'Perubahan berkas tidak bisa dibaca.');
      }
      const binary =
        /^Binary files .* differ$/m.test(r.stdout) || /^GIT binary patch$/m.test(r.stdout);
      return { path: rel, patch: binary ? '' : r.stdout, binary, truncated: r.truncated };
    },

    async log(target, limit) {
      const { cwd } = await resolve(target);
      if (!(await isRepo(cwd))) throw new PathError('invalid_request', NOT_A_REPO);
      const r = await git(
        cwd,
        ['log', `-n${limit}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e'],
        MAX_LOG_BYTES,
      );
      // Repo tanpa commit: `git log` gagal; daftar kosong, bukan galat.
      if (r.code !== 0 || r.spawnError) return { commits: [] };
      const commits = r.stdout
        .split('\x1e')
        .map((row) => row.trim())
        .filter(Boolean)
        .flatMap((row) => {
          const [hash, shortHash, subject, author, date] = row.split('\x1f');
          return hash && shortHash && date
            ? [{ hash, shortHash, subject: subject ?? '', author: author ?? '', date }]
            : [];
        });
      return { commits };
    },

    async stage(projectId, paths, all) {
      const cwd = await projectRepo(projectId);
      if (all) await act(cwd, ['add', '-A']);
      else if (paths.length > 0) await act(cwd, ['add', '--', ...paths.map(safePath)]);
      else throw new GitActionError('Pilih berkas yang akan di-stage.');
      return { message: all ? 'Semua perubahan di-stage.' : `${paths.length} berkas di-stage.` };
    },

    async unstage(projectId, paths, all) {
      const cwd = await projectRepo(projectId);
      const targets = all ? ['.'] : paths.map(safePath);
      if (targets.length === 0) {
        throw new GitActionError('Pilih berkas yang akan dikeluarkan dari stage.');
      }
      // Repo tanpa commit belum punya HEAD untuk dipulihkan: cukup keluarkan dari indeks.
      if (await hasHead(cwd)) await act(cwd, ['restore', '--staged', '--', ...targets]);
      else await act(cwd, ['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', ...targets]);
      return {
        message: all
          ? 'Semua berkas dikeluarkan dari stage.'
          : `${targets.length} berkas dikeluarkan dari stage.`,
      };
    },

    async discard(projectId, path) {
      const cwd = await projectRepo(projectId);
      const rel = safePath(path);
      const tracked = (await git(cwd, ['ls-files', '--error-unmatch', '--', rel], 1024)).code === 0;
      if (!tracked) {
        // Berkas baru yang belum dilacak: hapus berkas itu saja (bukan folder lain).
        await act(cwd, ['clean', '-f', '--', rel]);
      } else if (await hasHead(cwd)) {
        await act(cwd, ['restore', '--source=HEAD', '--staged', '--worktree', '--', rel]);
      } else {
        await act(cwd, ['rm', '-f', '--cached', '-q', '--', rel]);
      }
      return { message: `Perubahan ${rel} dibuang.` };
    },

    async commit(projectId, message) {
      const cwd = await projectRepo(projectId);
      // Kode keluar 1 = ada yang di-stage; 0 = tidak ada.
      const staged = await act(cwd, ['diff', '--cached', '--quiet'], ACTION_TIMEOUT_MS, [0, 1]);
      if (staged.code === 0 && (await hasHead(cwd))) {
        throw new GitActionError('Tidak ada perubahan yang di-stage. Stage berkas dulu.');
      }
      await act(cwd, ['commit', '-m', message], SLOW_ACTION_TIMEOUT_MS);
      const last = await this.log({ projectId }, 1);
      const commit = last.commits[0];
      if (!commit) throw new GitActionError('Commit selesai tetapi tidak terbaca.');
      return commit;
    },

    async branches(projectId) {
      return localBranches(await projectRepo(projectId));
    },

    async checkout(projectId, branch) {
      const cwd = await projectRepo(projectId);
      const { branches } = await localBranches(cwd);
      // Hanya branch lokal yang ada: nama bebas tidak pernah sampai ke git.
      if (!branches.includes(branch)) {
        throw new GitActionError(`Branch "${branch}" tidak ada di folder ini.`);
      }
      const r = await act(cwd, ['switch', branch]);
      return { message: summarize(r.stdout, r.stderr) || `Pindah ke ${branch}.` };
    },

    async pull(projectId) {
      const cwd = await projectRepo(projectId);
      const r = await act(cwd, ['pull', '--ff-only'], SLOW_ACTION_TIMEOUT_MS);
      return { message: summarize(r.stdout, r.stderr) || 'Sudah terbaru.' };
    },

    async push(projectId) {
      const cwd = await projectRepo(projectId);
      const remotes = (await act(cwd, ['remote'])).stdout
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);
      if (remotes.length === 0) {
        throw new GitActionError('Project ini belum punya remote untuk di-push.');
      }
      const { current } = await localBranches(cwd);
      if (!current) throw new GitActionError('HEAD lepas: pindah ke sebuah branch dulu.');
      const upstream = await git(
        cwd,
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
        1024,
      );
      const remote = remotes.includes('origin') ? 'origin' : (remotes[0] ?? 'origin');
      const args = upstream.code === 0 ? ['push'] : ['push', '-u', remote, current];
      const r = await act(cwd, args, SLOW_ACTION_TIMEOUT_MS);
      return { message: summarize(r.stdout, r.stderr) || `${current} di-push.` };
    },
  };
}
