import type { Database } from '../../db/client.js';
import { skillOpens } from '../../db/schema/index.js';
import type { SkillManager } from './manager.js';
import type { SkillsService } from './service.js';

/**
 * Pencatat skill yang terbukti dibuka agent (P11). Sumbernya hanya laporan `openedSkills` runner (bukti `read skill://`
 * di omp atau `skill_view` di Hermes). Id yang tidak ada di katalog diabaikan; skill yang tadinya ditandai usang
 * kembali dianggap hidup.
 */
export function createSkillUsage(deps: {
  db: Database;
  skills: SkillsService;
  manager: Pick<SkillManager, 'clearStale'>;
  now?: () => number;
}) {
  const { db, skills, manager } = deps;
  const now = deps.now ?? Date.now;
  return {
    async recordOpened(runId: string, ids: readonly string[]): Promise<void> {
      const known = [...new Set(ids)].filter((id) => skills.get(id) !== undefined);
      if (known.length === 0) return;
      await db
        .insert(skillOpens)
        .values(known.map((skillId) => ({ skillId, runId, openedAt: new Date(now()) })))
        .onConflictDoNothing();
      await manager.clearStale(known);
    },
  };
}
