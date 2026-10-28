import {
  CORE_SKILLS,
  ROLES_PACKAGE_DIR,
  RegistryError,
  buildBundle,
  loadRegistry,
  type Bundle,
  type Role,
  type RolesRegistry,
} from '@aios/roles';
import { INITIAL_ROLE_IDS, type RoleInfoSchema } from '@aios/contracts';
import { realpathSync, watch, type FSWatcher } from 'node:fs';
import type { z } from 'zod';

export type RoleInfo = z.infer<typeof RoleInfoSchema>;

export interface RolesService {
  list(): RoleInfo[];
  has(id: string): boolean;
  get(id: string): Role | undefined;
  /** Registri saat ini (berubah bila hot-reload); dipakai router. */
  registry(): RolesRegistry;
  /** System prompt untuk agent itu: aturan perilaku + agent + skill inti + skill khusus (milik agent dan `extraSkills`). */
  bundle(roleId: string, extraSkills?: readonly string[]): Bundle;
  close(): void;
}

export interface RolesServiceOptions {
  /** Folder berisi roles/ dan skills/. Default: isi paket @aios/roles. */
  dir?: string | undefined;
  /** Muat ulang saat file berubah (mode dev). */
  watch?: boolean;
  debounceMs?: number;
  log?: {
    info: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

const unique = <T>(items: T[]) => [...new Set(items)];

/**
 * Memuat role dan skill saat dibuat; melempar RegistryError bila ada yang tidak valid (gateway gagal start).
 * Dengan `watch`, perubahan file dimuat ulang; hasil yang tidak valid ditolak dan registri lama tetap dipakai.
 */
export function createRolesService(options: RolesServiceOptions = {}): RolesService {
  const { dir, debounceMs = 200, log } = options;
  let registry: RolesRegistry = loadRegistry(dir);

  let watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  if (options.watch) {
    const reload = () => {
      try {
        registry = loadRegistry(dir);
        log?.info(
          { roles: registry.roles.size, skills: registry.skills.size },
          'role dan skill dimuat ulang',
        );
      } catch (err) {
        log?.error(
          { problems: err instanceof RegistryError ? err.problems : String(err) },
          'perubahan role/skill ditolak, memakai versi sebelumnya',
        );
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, debounceMs);
      timer.unref();
    };
    // Bentuk path asli (bukan nama pendek 8.3): di Windows, libuv mematikan proses bila nama pada event
    // file tidak cocok dengan path yang dipantau.
    const base = realpathSync.native(dir ?? ROLES_PACKAGE_DIR);
    watchers = ['roles', 'skills'].map((sub) => {
      const w = watch(`${base}/${sub}`, { recursive: true }, schedule);
      w.unref();
      return w;
    });
  }

  const order = (id: string) => {
    const i = (INITIAL_ROLE_IDS as readonly string[]).indexOf(id);
    return i === -1 ? INITIAL_ROLE_IDS.length : i;
  };

  return {
    list() {
      return [...registry.roles.values()]
        .sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          group: r.group,
          engine: r.engine,
          model: r.model,
          fallbackModel: r.fallbackModel,
          approval: r.approval,
          skills: unique([...CORE_SKILLS, ...r.skills]),
        }));
    },
    registry: () => registry,
    has: (id) => registry.roles.has(id),
    get: (id) => registry.roles.get(id),
    bundle: (roleId, extraSkills) =>
      buildBundle(registry, roleId, extraSkills ? { extraSkills } : {}),
    close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
      watchers = [];
    },
  };
}
