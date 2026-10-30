import { useWorkspaceRuns } from '../api/queries';
import type { WorkspaceRun } from '../workspace/runs';

/** Run coding terbaru per project (id project → run). Gagal memuat tidak memblokir layar: kolom aktivitas kosong. */
export function useLatestRuns(): Record<string, WorkspaceRun> {
  const query = useWorkspaceRuns();
  const latest: Record<string, WorkspaceRun> = {};
  // Urutan stabil: waktu sama mempertahankan urutan server (terbaru dulu).
  const sorted = [...(query.data ?? [])].sort((a, b) =>
    b.run.updatedAt.localeCompare(a.run.updatedAt),
  );
  for (const entry of sorted) {
    if (entry.projectId && !(entry.projectId in latest)) latest[entry.projectId] = entry;
  }
  return latest;
}
