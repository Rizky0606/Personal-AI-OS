import type { GitInfo } from '@aios/contracts';
import type { ProcessManager } from '../process/manager.js';

const GIT_TIMEOUT_MS = 10_000;
const FALLBACK_BRANCH = 'main';

/**
 * Info git folder project. Bukan repo (atau git tidak terpasang) bukan galat: `isRepo` false.
 * Cabang bawaan: `origin/HEAD` bila ada remote; kalau tidak, cabang saat ini; terakhir `main`.
 */
export async function detectGit(processes: ProcessManager, dir: string): Promise<GitInfo> {
  const git = async (...args: string[]) => {
    const result = await processes.run('git', args, {
      cwd: dir,
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024,
      // Tanpa prompt kredensial dan tanpa menulis file kunci di repo pengguna.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    });
    return result.code === 0 && !result.spawnError ? result.stdout.trim() : undefined;
  };

  if ((await git('rev-parse', '--is-inside-work-tree')) !== 'true') {
    return { isRepo: false, defaultBranch: null, currentBranch: null };
  }

  const current = (await git('symbolic-ref', '--short', '-q', 'HEAD')) ?? null;
  const remoteHead = await git('symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD');
  const fromRemote = remoteHead?.startsWith('origin/') ? remoteHead.slice('origin/'.length) : null;

  return {
    isRepo: true,
    defaultBranch: fromRemote ?? current ?? FALLBACK_BRANCH,
    currentBranch: current,
  };
}
