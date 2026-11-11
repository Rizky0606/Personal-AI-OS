import type {
  HermesSkillListSchema,
  HermesSkillPreview,
  SkillInstallPreview,
} from '@aios/contracts';
import type { z } from 'zod';
import { AppError } from '../../errors.js';
import {
  checksumOfBody,
  fetchSkill,
  mentionsScripts,
  resolveSource,
  type FetchLike,
  type FetchedSkill,
  type ResolvedSource,
} from './installer.js';
import type { HermesSkillSource } from './hermes-skills.js';
import { slugifySkillId, type SkillChange, type SkillManager } from './manager.js';
import { scanSkill } from './scanner.js';
import type { SkillsService } from './service.js';

/**
 * Pemasangan dari luar dan impor dari Hermes (P10). Satu-satunya yang mengunduh adalah gateway ini; tidak ada
 * yang dijalankan. Pengguna harus melihat pratinjau (isi lengkap + diff terhadap versi terpasang) sebelum
 * `install`, dan `install` mengunci checksum yang dilihat pengguna.
 */
export type HermesSkillList = z.infer<typeof HermesSkillListSchema>;

export interface InstallService {
  preview(source: string): Promise<SkillInstallPreview>;
  install(input: { source: string; checksum: string; acknowledge?: boolean }): Promise<SkillChange>;
  listHermes(): Promise<HermesSkillList>;
  importHermes(input: { name: string; acknowledge?: boolean }): Promise<SkillChange>;
  /** Hanya baca: isi + hasil pemindai satu skill Hermes, supaya `acknowledge` diberikan dengan melihat isinya. */
  previewHermes(input: { name: string }): Promise<HermesSkillPreview>;
}

/** Sama dengan pemeriksaan isi di manager: isi katalog tidak boleh diawali blok frontmatter. */
const NESTED_FRONTMATTER = /^\s*---\s*\r?\n/;

export function createInstallService(deps: {
  skills: SkillsService;
  manager: SkillManager;
  hermes?: HermesSkillSource;
  fetchImpl?: FetchLike;
}): InstallService {
  const { skills, manager, hermes, fetchImpl } = deps;

  /** Tentukan apa yang terjadi bila skill dengan `origin` ini dipasang. */
  const plan = (id: string, origin: string) => {
    const existing = skills.get(id);
    if (!existing) return { action: 'install' as const, existing: null };
    const shown = {
      id: existing.id,
      version: existing.version,
      source: existing.source,
      body: existing.body,
    };
    if (existing.source === 'builtin')
      return {
        action: 'conflict' as const,
        existing: shown,
        reason: `Id "${id}" dipakai skill bawaan repo.`,
      };
    if (existing.source === 'installed' && existing.origin === origin)
      return { action: 'update' as const, existing: shown };
    return {
      action: 'conflict' as const,
      existing: shown,
      reason: `Id "${id}" sudah dipakai skill ${existing.source} lain; hapus atau ganti namanya dulu.`,
    };
  };

  const candidateOf = (fetched: FetchedSkill) => ({
    id: slugifySkillId(fetched.name),
    name: fetched.name,
    description: fetched.description,
    body: fetched.body,
    checksum: fetched.checksum,
    descriptionTrimmed: fetched.descriptionTrimmed,
    mentionsScripts: fetched.mentionsScripts,
  });

  const load = async (
    source: string,
  ): Promise<{ resolved: ResolvedSource; fetched: FetchedSkill }> => {
    const resolved = resolveSource(source);
    return { resolved, fetched: await fetchSkill(resolved, fetchImpl) };
  };

  const apply = (
    action: 'install' | 'update',
    candidate: { id: string; name: string; description: string; body: string },
    origin: string,
    acknowledge: boolean | undefined,
    /** Hanya impor dari folder Hermes milik pemilik yang boleh menyetujui temuan `dangerous`. */
    ownerFolder = false,
  ): Promise<SkillChange> =>
    action === 'update'
      ? manager.update(
          candidate.id,
          {
            name: candidate.name,
            description: candidate.description,
            body: candidate.body,
            acknowledge,
          },
          'import',
          { ownerFolder },
        )
      : manager.create(
          {
            id: candidate.id,
            name: candidate.name,
            description: candidate.description,
            body: candidate.body,
            acknowledge,
          },
          { source: 'installed', origin, actor: 'import', ownerFolder },
        );

  return {
    async preview(source) {
      const { resolved, fetched } = await load(source);
      const candidate = candidateOf(fetched);
      if (candidate.id === '')
        throw new AppError(422, 'skill_id_invalid', 'Nama skill tidak bisa dijadikan id.');
      const scan = scanSkill({ body: fetched.body, description: fetched.description });
      const decided = plan(candidate.id, resolved.input);
      const reason =
        decided.action === 'conflict'
          ? decided.reason
          : scan.verdict === 'dangerous'
            ? 'Pemindai menemukan isi berbahaya; skill ini diblokir.'
            : undefined;
      return {
        source: { kind: resolved.kind, input: resolved.input, url: fetched.url },
        candidate,
        scan,
        existing: decided.existing,
        action: decided.action,
        installable: reason === undefined,
        ...(reason ? { reason } : {}),
      };
    },

    async install({ source, checksum, acknowledge }) {
      const { resolved, fetched } = await load(source);
      if (fetched.checksum !== checksum)
        throw new AppError(
          409,
          'skill_changed_upstream',
          'Isi di sumber berubah sejak pratinjau; lihat pratinjau lagi sebelum memasang.',
        );
      const candidate = candidateOf(fetched);
      const decided = plan(candidate.id, resolved.input);
      if (decided.action === 'conflict') throw new AppError(409, 'skill_id_taken', decided.reason);
      return apply(decided.action, candidate, resolved.input, acknowledge);
    },

    async listHermes() {
      if (!hermes)
        return { items: [], via: 'none', note: 'Sumber skill Hermes tidak dikonfigurasi.' };
      const found = await hermes.list();
      const imported = new Set(
        skills
          .list({ include: 'all' })
          .filter((s) => s.source === 'installed' && s.origin?.startsWith('hermes:'))
          .map((s) => s.origin!.slice('hermes:'.length)),
      );
      const readable = new Set(found.readable);
      return {
        items: found.items.map((item) => ({
          name: item.name,
          description: item.description,
          imported: imported.has(item.name),
          importable: readable.has(item.name),
        })),
        via: found.via,
        ...(found.note ? { note: found.note } : {}),
      };
    },

    async importHermes({ name, acknowledge }) {
      if (!hermes?.readable)
        throw new AppError(
          422,
          'hermes_folder_unconfigured',
          'Isi skill Hermes dibaca dari folder skill-nya; isi HERMES_SKILLS_DIR.',
        );
      const skill = await hermes.read(name);
      if (!skill)
        throw new AppError(404, 'hermes_skill_not_found', `Skill Hermes "${name}" tidak ada.`);
      const origin = `hermes:${name}`;
      const candidate = {
        id: slugifySkillId(skill.name),
        name: skill.name,
        description: skill.description,
        body: skill.body,
      };
      if (candidate.id === '')
        throw new AppError(422, 'skill_id_invalid', 'Nama skill tidak bisa dijadikan id.');
      const decided = plan(candidate.id, origin);
      if (decided.action === 'conflict') throw new AppError(409, 'skill_id_taken', decided.reason);
      return apply(decided.action, candidate, origin, acknowledge, true);
    },

    async previewHermes({ name }) {
      if (!hermes?.readable)
        throw new AppError(
          422,
          'hermes_folder_unconfigured',
          'Isi skill Hermes dibaca dari folder skill-nya; isi HERMES_SKILLS_DIR.',
        );
      const skill = await hermes.read(name);
      if (!skill)
        throw new AppError(404, 'hermes_skill_not_found', `Skill Hermes "${name}" tidak ada.`);
      const id = slugifySkillId(skill.name);
      if (id === '')
        throw new AppError(422, 'skill_id_invalid', 'Nama skill tidak bisa dijadikan id.');
      const decided = plan(id, `hermes:${name}`);
      const scan = scanSkill({ body: skill.body, description: skill.description });
      const reason =
        decided.action === 'conflict'
          ? decided.reason
          : NESTED_FRONTMATTER.test(skill.body)
            ? 'Isi skill membawa frontmatter kedua (--- ... ---); aturan katalog menolaknya dan isi tidak diubah otomatis.'
            : undefined;
      return {
        candidate: {
          id,
          name: skill.name,
          description: skill.description,
          body: skill.body,
          checksum: checksumOfBody(skill.body),
          mentionsScripts: mentionsScripts(skill.body),
        },
        scan,
        existing: decided.existing,
        action: decided.action,
        importable: reason === undefined,
        ...(reason ? { reason } : {}),
        needsAcknowledge: scan.verdict !== 'safe',
      };
    },
  };
}
