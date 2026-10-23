import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import type { ProjectBinding } from '@aios/contracts';
import { z } from 'zod';
import type { AllowList } from '../paths/allowlist.js';

const FileSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), z.string().min(1)),
});

/**
 * Peta projectId ke folder lokal. Path hanya disimpan di PC ini: gateway tidak pernah menerimanya
 * (ARCHITECTURE.md, "Kepemilikan data").
 */
export class ProjectBindings {
  private map = new Map<string, string>();

  constructor(
    private readonly file: string,
    private readonly allowed: AllowList,
  ) {}

  async load(): Promise<void> {
    try {
      const parsed = FileSchema.safeParse(JSON.parse(await fs.readFile(this.file, 'utf8')));
      this.map = new Map(parsed.success ? Object.entries(parsed.data.projects) : []);
    } catch {
      this.map = new Map();
    }
  }

  /** Mengikat project ke folder (harus berada di folder yang diizinkan dan benar-benar folder). */
  async bind(projectId: string, path: string): Promise<ProjectBinding> {
    const real = await this.allowed.resolveDirectory(path);
    this.map.set(projectId, real);
    await this.save();
    return { projectId, path: real, available: true };
  }

  async unbind(projectId: string): Promise<void> {
    if (this.map.delete(projectId)) await this.save();
  }

  /** `available` false bila folder hilang atau izinnya sudah dicabut. */
  async list(): Promise<ProjectBinding[]> {
    return Promise.all(
      [...this.map].map(async ([projectId, path]) => ({
        projectId,
        path,
        available: await this.allowed
          .resolveDirectory(path)
          .then(() => true)
          .catch(() => false),
      })),
    );
  }

  /** Path folder project untuk dipakai menjalankan agent; melempar bila tidak lagi diizinkan. */
  async pathFor(projectId: string): Promise<string | undefined> {
    const path = this.map.get(projectId);
    return path === undefined ? undefined : this.allowed.resolveDirectory(path);
  }

  private async save(): Promise<void> {
    await fs.mkdir(nodePath.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(
      temp,
      JSON.stringify({ version: 1, projects: Object.fromEntries(this.map) }, null, 2),
    );
    await fs.rename(temp, this.file);
  }
}
