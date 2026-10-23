import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { ZodType } from 'zod';
import {
  CORE_SKILLS,
  RoleFrontmatterSchema,
  SkillFrontmatterSchema,
  type RoleFrontmatter,
} from './schema.js';

/** Folder paket: berisi `roles/` dan `skills/`. Sama untuk dist/ maupun src/. */
export const ROLES_PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

export interface Role {
  id: string;
  name: string;
  group: RoleFrontmatter['group'];
  engine: RoleFrontmatter['engine'];
  model: string;
  fallbackModel: string | null;
  approval: RoleFrontmatter['approval'];
  /** Skill yang tertulis di frontmatter, sesuai urutan. */
  skills: string[];
  handoff: Record<string, string>;
  examples: string[];
  notExamples: string[];
  /** Isi markdown (di luar frontmatter): menjadi bagian system prompt. */
  body: string;
  file: string;
}

export interface Skill {
  id: string;
  description: string;
  body: string;
  file: string;
}

export interface RolesRegistry {
  roles: ReadonlyMap<string, Role>;
  skills: ReadonlyMap<string, Skill>;
}

/** Semua masalah ditampung dan dilaporkan sekaligus, supaya satu kali perbaikan cukup. */
export class RegistryError extends Error {
  constructor(readonly problems: string[]) {
    super(`Role dan skill tidak valid:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'RegistryError';
  }
}

const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/** Memisahkan frontmatter YAML dari isi markdown. */
export function splitFrontmatter(text: string): { data: unknown; body: string } {
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error('frontmatter (--- ... ---) tidak ditemukan di awal file');
  let data: unknown;
  try {
    data = parseYaml(match[1] ?? '');
  } catch (err) {
    throw new Error(
      `YAML tidak valid: ${err instanceof Error ? (err.message.split('\n')[0] ?? 'error') : 'error'}`,
      { cause: err },
    );
  }
  return { data, body: (match[2] ?? '').trim() };
}

function validate<T>(schema: ZodType<T>, data: unknown, file: string, problems: string[]) {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) {
    problems.push(`${file}: ${issue.path.join('.') || '(frontmatter)'} — ${issue.message}`);
  }
  return undefined;
}

function readParts(file: string, label: string, problems: string[]) {
  try {
    return splitFrontmatter(readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`${label}: ${err instanceof Error ? err.message : 'gagal dibaca'}`);
    return undefined;
  }
}

/**
 * Memuat dan memvalidasi semua role dan skill. Melempar RegistryError bila ada yang tidak valid:
 * frontmatter salah, id tidak sama dengan nama file, skill yang dirujuk tidak ada, skill inti hilang.
 */
export function loadRegistry(dir: string = ROLES_PACKAGE_DIR): RolesRegistry {
  const problems: string[] = [];
  const roles = new Map<string, Role>();
  const skills = new Map<string, Skill>();

  const skillsDir = join(dir, 'skills');
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir).sort()) {
      const folder = join(skillsDir, entry);
      if (!statSync(folder).isDirectory()) continue;
      const file = join(folder, 'SKILL.md');
      const label = `skills/${entry}/SKILL.md`;
      if (!existsSync(file)) {
        problems.push(`${label}: file tidak ada`);
        continue;
      }
      const parts = readParts(file, label, problems);
      if (!parts) continue;
      const meta = validate(SkillFrontmatterSchema, parts.data, label, problems);
      if (!meta) continue;
      if (meta.name !== entry)
        problems.push(`${label}: name "${meta.name}" harus sama dengan nama folder`);
      if (!parts.body) problems.push(`${label}: isi skill kosong`);
      skills.set(entry, {
        id: entry,
        description: meta.description,
        body: parts.body,
        file: label,
      });
    }
  } else {
    problems.push('folder skills/ tidak ada');
  }

  const rolesDir = join(dir, 'roles');
  if (existsSync(rolesDir)) {
    for (const entry of readdirSync(rolesDir).sort()) {
      if (!entry.endsWith('.md')) continue;
      const label = `roles/${entry}`;
      const parts = readParts(join(rolesDir, entry), label, problems);
      if (!parts) continue;
      const meta = validate(RoleFrontmatterSchema, parts.data, label, problems);
      if (!meta) continue;
      if (meta.id !== basename(entry, '.md')) {
        problems.push(`${label}: id "${meta.id}" harus sama dengan nama file`);
      }
      if (!parts.body) problems.push(`${label}: isi role (system prompt) kosong`);
      roles.set(meta.id, {
        id: meta.id,
        name: meta.name,
        group: meta.group,
        engine: meta.engine,
        model: meta.model,
        fallbackModel: meta.fallback_model ?? null,
        approval: meta.approval,
        skills: meta.skills,
        handoff: meta.handoff,
        examples: meta.examples,
        notExamples: meta.not_examples,
        body: parts.body,
        file: label,
      });
    }
  } else {
    problems.push('folder roles/ tidak ada');
  }

  if (roles.size === 0 && problems.length === 0) problems.push('tidak ada role');
  for (const core of CORE_SKILLS) {
    if (!skills.has(core)) problems.push(`skill inti "${core}" tidak ada`);
  }
  if (roles.size > 0 && !roles.has('general')) {
    problems.push('role "general" wajib ada: dipakai router sebagai cadangan');
  }
  for (const role of roles.values()) {
    for (const skill of role.skills) {
      if (!skills.has(skill))
        problems.push(`${role.file}: merujuk skill "${skill}" yang tidak ada`);
    }
    for (const target of Object.keys(role.handoff)) {
      if (target === role.id) problems.push(`${role.file}: handoff ke dirinya sendiri`);
      else if (!roles.has(target))
        problems.push(`${role.file}: handoff ke role "${target}" yang tidak ada`);
    }
  }

  if (problems.length > 0) throw new RegistryError(problems);
  return { roles, skills };
}
