import {
  MAX_GIT_FILES,
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
}

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
  };
}
