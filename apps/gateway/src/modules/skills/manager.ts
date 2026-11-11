import { CORE_SKILLS, type RolesRegistry } from '@aios/roles';
import {
  SKILL_BODY_MAX_BYTES,
  SKILL_ID_PATTERN,
  type CreateSkillRequestSchema,
  type SkillEngine,
  type SkillScan,
  type SkillStatus,
  type SkillVersionListSchema,
  type UpdateSkillRequestSchema,
} from '@aios/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { catalogSkillVersions, catalogSkills, skillOverrides } from '../../db/schema/index.js';
import { AppError } from '../../errors.js';
import { scanSkill } from './scanner.js';
import { ALL_ENGINES, type CatalogExtra } from './service.js';

/**
 * Pengelola skill tambahan di database (P10): buat, ubah (membuat versi baru), kembalikan versi, nonaktifkan,
 * arsipkan, hapus permanen. Skill bawaan repo tidak pernah ditulis di sini; hanya status "nonaktif"-nya yang
 * dicatat di `skill_overrides`. Setiap perubahan menyegarkan snapshot memori yang dibaca `SkillsService` lalu
 * memicu `onChange` (sinkron ke folder skill Hermes, P9) -- kegagalan sinkron tidak membatalkan perubahan.
 */
export type SkillActor = 'user' | 'agent' | 'import';
type CreateInput = z.infer<typeof CreateSkillRequestSchema>;
type UpdateInput = z.infer<typeof UpdateSkillRequestSchema>;
export type SkillVersions = z.infer<typeof SkillVersionListSchema>['items'];
export type HermesSyncState = 'off' | 'ok' | 'failed';
export interface SkillChange {
  id: string;
  scan: SkillScan;
  hermesSync: HermesSyncState;
}

/** Sumber penulis -> sumber skill. Skill buatan tangan = user; usulan agent = agent; dipasang = installed. */
export type NewSkillSource = 'user' | 'installed' | 'agent';

export interface SkillManager {
  load(): Promise<void>;
  extras(): CatalogExtra[];
  overrides(): ReadonlyMap<string, SkillStatus>;
  scan(input: { body: string; description?: string }): SkillScan;
  create(
    input: CreateInput,
    options?: {
      source?: NewSkillSource;
      origin?: string;
      actor?: SkillActor;
      ownerFolder?: boolean;
    },
  ): Promise<SkillChange>;
  update(
    id: string,
    patch: UpdateInput,
    actor?: SkillActor,
    options?: { ownerFolder?: boolean },
  ): Promise<SkillChange>;
  setStatus(id: string, status: SkillStatus): Promise<SkillChange>;
  restore(id: string, version: number): Promise<SkillChange>;
  remove(id: string): Promise<{ hermesSync: HermesSyncState }>;
  versions(id: string): Promise<SkillVersions>;
  /** Sinkron manual ke Hermes (dipakai setelah impor massal). */
  sync(): Promise<HermesSyncState>;
}

type Row = typeof catalogSkills.$inferSelect;

const toExtra = (row: Row): CatalogExtra => ({
  id: row.id,
  name: row.name,
  description: row.description,
  version: String(row.version),
  body: row.body,
  source: row.source,
  trust: row.trust,
  status: row.status,
  engines: row.engines,
  pinned: row.pinned,
  origin: row.origin,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Id dari nama: huruf kecil, tanpa aksen, pemisah `-`, selalu diawali huruf, maks 64 karakter. */
export function slugifySkillId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  if (slug === '') return '';
  return /^[a-z]/.test(slug) ? slug : `skill-${slug}`.slice(0, 64).replace(/-+$/g, '');
}

/** Id yang bentrok dengan rute `/skills/<kata>`. */
const RESERVED_IDS = new Set(['scan', 'install', 'hermes']);

const findingErrors = (scan: SkillScan) =>
  scan.findings.slice(0, 10).map((f) => ({
    path: f.line === 0 ? 'deskripsi' : `baris ${f.line}`,
    message: `${f.message} "${f.excerpt}"`,
  }));

export function createSkillManager(deps: {
  db: Database;
  registry: () => RolesRegistry;
  /** Dipanggil setelah setiap perubahan; mengembalikan hasil sinkron ke Hermes. Tidak ada = `off`. */
  onChange?: () => Promise<HermesSyncState>;
  log?: { warn(obj: object, msg: string): void };
}): SkillManager {
  const { db, registry, onChange, log } = deps;
  const core = new Set<string>(CORE_SKILLS);
  let rows: CatalogExtra[] = [];
  let off = new Map<string, SkillStatus>();

  const refresh = async () => {
    const [all, overrides] = await Promise.all([
      db.select().from(catalogSkills),
      db.select().from(skillOverrides),
    ]);
    rows = all.map(toExtra);
    off = new Map(
      overrides.filter((o) => o.status !== 'active').map((o) => [o.skillId, o.status] as const),
    );
  };
  const sync = async (): Promise<HermesSyncState> => {
    if (!onChange) return 'off';
    try {
      return await onChange();
    } catch (err) {
      log?.warn({ err }, 'sinkron skill ke Hermes gagal; perubahan di katalog tetap tersimpan');
      return 'failed';
    }
  };
  const done = async (id: string, scan: SkillScan): Promise<SkillChange> => {
    await refresh();
    return { id, scan, hermesSync: await sync() };
  };

  const builtinIds = () => new Set(registry().skills.keys());
  const notFound = (id: string) => new AppError(404, 'skill_not_found', `Skill "${id}" tidak ada.`);
  const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

  const checkBody = (body: string) => {
    if (bytes(body) > SKILL_BODY_MAX_BYTES)
      throw new AppError(
        422,
        'skill_too_large',
        `Isi skill melebihi ${SKILL_BODY_MAX_BYTES / 1024} KB.`,
      );
    if (/^\s*---\s*\r?\n/.test(body))
      throw new AppError(
        422,
        'skill_body_has_frontmatter',
        'Isi skill tidak boleh membawa frontmatter (--- ... ---); nama dan deskripsi diisi terpisah.',
      );
  };

  /** Berbahaya: diblokir untuk skill dari luar/agent, dan butuh `acknowledge` untuk skill buatan sendiri. */
  const gate = (
    source: NewSkillSource,
    scan: SkillScan,
    acknowledge: boolean | undefined,
    /** Impor dari folder Hermes milik pemilik: `dangerous` boleh disetujui eksplisit (setelah pratinjau). */
    ownerFolder = false,
  ) => {
    if (scan.verdict === 'dangerous' && ((source !== 'user' && !ownerFolder) || !acknowledge)) {
      throw new AppError(
        422,
        'skill_scan_blocked',
        source === 'user' || ownerFolder
          ? 'Pemindai menemukan isi berbahaya. Periksa baris yang ditandai; kirim ulang dengan acknowledge bila memang disengaja.'
          : 'Pemindai menemukan isi berbahaya; skill dari luar/agent diblokir.',
        findingErrors(scan),
      );
    }
    if (scan.verdict === 'warning' && source !== 'user' && !acknowledge) {
      throw new AppError(
        422,
        'skill_scan_confirm',
        'Pemindai memberi peringatan; periksa baris yang ditandai lalu setujui secara eksplisit (acknowledge).',
        findingErrors(scan),
      );
    }
  };

  const mustGetRow = async (id: string): Promise<Row> => {
    const [row] = await db.select().from(catalogSkills).where(eq(catalogSkills.id, id));
    if (row) return row;
    if (builtinIds().has(id))
      throw new AppError(409, 'skill_builtin', `Skill bawaan "${id}" tidak bisa diubah dari UI.`);
    throw notFound(id);
  };

  return {
    async load() {
      await refresh();
    },
    extras: () => rows,
    overrides: () => off,
    scan: (input) => scanSkill(input),
    sync,

    async create(input, { source = 'user', origin, actor = 'user', ownerFolder = false } = {}) {
      const id = input.id ?? slugifySkillId(input.name);
      if (!SKILL_ID_PATTERN.test(id))
        throw new AppError(
          422,
          'skill_id_invalid',
          'Id skill harus huruf kecil, angka, dan tanda hubung, diawali huruf (maks 64 karakter).',
        );
      if (RESERVED_IDS.has(id))
        throw new AppError(422, 'skill_id_reserved', `Id "${id}" dicadangkan untuk rute katalog.`);
      checkBody(input.body);
      if (builtinIds().has(id))
        throw new AppError(409, 'skill_id_taken', `Id "${id}" dipakai skill bawaan.`);
      const scan = scanSkill({ body: input.body, description: input.description });
      gate(source, scan, input.acknowledge, ownerFolder);
      const engines: SkillEngine[] = input.engines ?? [...ALL_ENGINES];
      try {
        await db.transaction(async (tx) => {
          await tx.insert(catalogSkills).values({
            id,
            name: input.name,
            description: input.description,
            body: input.body,
            source,
            trust: 'community',
            engines,
            pinned: input.pinned ?? false,
            origin: origin ?? null,
            version: 1,
          });
          await tx.insert(catalogSkillVersions).values({
            skillId: id,
            version: 1,
            name: input.name,
            description: input.description,
            body: input.body,
            changedBy: actor,
          });
        });
      } catch (err) {
        const code =
          (err as { code?: string; cause?: { code?: string } }).code ??
          (err as { cause?: { code?: string } }).cause?.code;
        if (code === '23505')
          throw new AppError(409, 'skill_id_taken', `Sudah ada skill dengan id "${id}".`);
        throw err;
      }
      return done(id, scan);
    },

    async update(id, patch, actor = 'user', { ownerFolder = false } = {}) {
      const row = await mustGetRow(id);
      const next = {
        name: patch.name ?? row.name,
        description: patch.description ?? row.description,
        body: patch.body ?? row.body,
      };
      const contentChanged =
        next.name !== row.name || next.description !== row.description || next.body !== row.body;
      if (patch.body !== undefined) checkBody(patch.body);
      const scan = scanSkill({ body: next.body, description: next.description });
      if (contentChanged) gate(row.source, scan, patch.acknowledge, ownerFolder);
      await db.transaction(async (tx) => {
        const version = contentChanged ? row.version + 1 : row.version;
        if (contentChanged) {
          await tx.insert(catalogSkillVersions).values({
            skillId: id,
            version,
            ...next,
            changedBy: actor,
          });
        }
        await tx
          .update(catalogSkills)
          .set({
            ...next,
            version,
            engines: patch.engines ?? row.engines,
            pinned: patch.pinned ?? row.pinned,
            // Hanya pengguna yang menaikkan kepercayaan (tidak ada jalur otomatis ke "trusted").
            trust: patch.trust ?? row.trust,
            updatedAt: new Date(),
          })
          .where(eq(catalogSkills.id, id));
      });
      return done(id, scan);
    },

    async setStatus(id, status) {
      if (builtinIds().has(id)) {
        if (status === 'archived')
          throw new AppError(
            409,
            'skill_builtin',
            'Skill bawaan tidak bisa diarsipkan; nonaktifkan saja.',
          );
        if (core.has(id) && status !== 'active')
          throw new AppError(
            409,
            'skill_core',
            `"${id}" adalah skill inti yang selalu dipasang; tidak bisa dinonaktifkan.`,
          );
        if (status === 'active')
          await db.delete(skillOverrides).where(eq(skillOverrides.skillId, id));
        else
          await db
            .insert(skillOverrides)
            .values({ skillId: id, status })
            .onConflictDoUpdate({
              target: skillOverrides.skillId,
              set: { status, updatedAt: new Date() },
            });
        return done(id, { verdict: 'safe', findings: [] });
      }
      const row = await mustGetRow(id);
      await db
        .update(catalogSkills)
        .set({ status, updatedAt: new Date() })
        .where(eq(catalogSkills.id, id));
      return done(id, scanSkill({ body: row.body, description: row.description }));
    },

    async restore(id, version) {
      const row = await mustGetRow(id);
      const [target] = await db
        .select()
        .from(catalogSkillVersions)
        .where(
          and(eq(catalogSkillVersions.skillId, id), eq(catalogSkillVersions.version, version)),
        );
      if (!target)
        throw new AppError(
          422,
          'skill_version_unknown',
          `Versi ${version} tidak ada untuk "${id}".`,
        );
      if (target.version === row.version)
        throw new AppError(409, 'skill_version_current', `Versi ${version} sudah versi terbaru.`);
      const scan = scanSkill({ body: target.body, description: target.description });
      gate(row.source, scan, true);
      const next = row.version + 1;
      await db.transaction(async (tx) => {
        await tx.insert(catalogSkillVersions).values({
          skillId: id,
          version: next,
          name: target.name,
          description: target.description,
          body: target.body,
          changedBy: `restore:v${version}`,
        });
        await tx
          .update(catalogSkills)
          .set({
            name: target.name,
            description: target.description,
            body: target.body,
            version: next,
            updatedAt: new Date(),
          })
          .where(eq(catalogSkills.id, id));
      });
      return done(id, scan);
    },

    async remove(id) {
      await mustGetRow(id);
      await db.delete(catalogSkills).where(eq(catalogSkills.id, id));
      await refresh();
      return { hermesSync: await sync() };
    },

    async versions(id) {
      await mustGetRow(id);
      const list = await db
        .select()
        .from(catalogSkillVersions)
        .where(eq(catalogSkillVersions.skillId, id))
        .orderBy(desc(catalogSkillVersions.version));
      return list.map((v) => ({
        version: v.version,
        name: v.name,
        description: v.description,
        body: v.body,
        changedBy: v.changedBy,
        createdAt: v.createdAt.toISOString(),
      }));
    },
  };
}
