/** Satu langkah tool agent, seperti yang tampil di pesan (live maupun tersimpan). */
export interface ActivityStep {
  id: string;
  name: string;
  target?: string | undefined;
  status: 'running' | 'ok' | 'error' | 'denied' | 'cancelled';
}

export type ToolKind = 'read' | 'edit' | 'search' | 'command' | 'web' | 'other';

const READ = new Set(['read', 'cat', 'view', 'open']);
const EDIT = new Set(['write', 'edit', 'patch', 'delete', 'rm', 'notebook', 'multiedit', 'create']);
const SEARCH = new Set(['grep', 'find', 'ls', 'glob', 'search', 'list', 'tree']);
const WEB = new Set(['fetch', 'web_search', 'websearch', 'web', 'browser']);
const COMMAND = new Set(['bash', 'shell', 'sh', 'exec', 'run', 'terminal']);

/** Jenis langkah menurut nama tool; nama tool MCP (`mcp__...`) dan yang tak dikenal jadi `other`. */
export function toolKind(name: string): ToolKind {
  const n = name.toLowerCase();
  if (READ.has(n)) return 'read';
  if (EDIT.has(n)) return 'edit';
  if (SEARCH.has(n)) return 'search';
  if (WEB.has(n)) return 'web';
  if (COMMAND.has(n)) return 'command';
  return 'other';
}

export interface FileActivity {
  /** Path relatif terhadap folder project atau worktree run; null bila tidak bisa direlatifkan. */
  path: string;
  /** `edit` mengalahkan `read` bila berkas yang sama dibaca lalu diubah. */
  action: 'read' | 'edit';
  /** Langkah terakhir pada berkas ini masih berjalan. */
  running: boolean;
  /** Berapa kali disentuh. */
  count: number;
}

/**
 * Path berkas relatif dari target tool. Worker menjalankan agent di `worktrees/<runId>/`, jadi bagian itu
 * dibuang; path absolut di luar worktree tidak bisa dibuka di tab Berkas dan mengembalikan null.
 */
export function relativePath(target: string | undefined): string | null {
  if (!target) return null;
  const raw = target.trim().replace(/\\/g, '/');
  if (!raw || raw.includes('\n')) return null;
  const inWorktree = /\/worktrees\/[^/]+\/(.+)$/.exec(raw);
  if (inWorktree?.[1]) return inWorktree[1];
  if (/^([a-z]:)?\//i.test(raw)) return null;
  const cleaned = raw.replace(/^\.\//, '').replace(/:\d+(-\d+)?$/, '');
  return cleaned && !cleaned.startsWith('..') ? cleaned : null;
}

/** Berkas yang dibaca atau diubah agent, yang terakhir disentuh di atas. */
export function fileActivities(steps: readonly ActivityStep[]): FileActivity[] {
  const byPath = new Map<string, FileActivity>();
  for (const step of steps) {
    const kind = toolKind(step.name);
    if (kind !== 'read' && kind !== 'edit') continue;
    const path = relativePath(step.target);
    if (!path) continue;
    const previous = byPath.get(path);
    byPath.delete(path);
    byPath.set(path, {
      path,
      action: kind === 'edit' || previous?.action === 'edit' ? 'edit' : 'read',
      running: step.status === 'running',
      count: (previous?.count ?? 0) + 1,
    });
  }
  return [...byPath.values()].reverse();
}

/** Langkah yang sedang berjalan sekarang (yang terakhir bila beberapa). */
export function currentStep(steps: readonly ActivityStep[]): ActivityStep | undefined {
  return [...steps].reverse().find((s) => s.status === 'running');
}

/** Langkah selain membaca/mengubah berkas (pencarian, perintah, web), terbaru di atas, dibatasi. */
export function otherSteps(steps: readonly ActivityStep[], limit = 8): ActivityStep[] {
  return steps
    .filter((s) => {
      const kind = toolKind(s.name);
      return kind !== 'read' && kind !== 'edit';
    })
    .slice(-limit)
    .reverse();
}
