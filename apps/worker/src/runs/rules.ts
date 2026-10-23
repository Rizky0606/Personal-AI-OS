import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { z } from 'zod';

const RuleSchema = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['command', 'file_write', 'network']),
  /** Perintah/URL persis (spasi dinormalkan), atau `*` untuk semua penulisan file di worktree. */
  pattern: z.string().min(1),
});
export type ApprovalRule = z.infer<typeof RuleSchema>;

const FileSchema = z.object({ version: z.literal(1), rules: z.array(RuleSchema) });

export type RuleKind = ApprovalRule['kind'];

/** Spasi berulang dan ujung dirapikan; huruf tidak diubah (perintah membedakan huruf besar/kecil). */
export const normalizeDetail = (detail: string): string => detail.trim().replace(/\s+/g, ' ');

/**
 * Aturan "selalu izinkan untuk project ini" (SECURITY_OPS.md). Omp tidak punya aturan permanen per pola
 * (docs/VERIFICATION.md), jadi disimpan di worker dan dijawab otomatis di sini. Sengaja sempit:
 * - perintah dan URL: cocok persis, bukan awalan, jadi `pnpm test` tidak membuka `pnpm test && rm -rf`.
 * - penulisan file: seluruh penulisan agent di worktree project itu (sudah terisolasi dan ditinjau sebelum diterima).
 * Hanya keputusan "izinkan" yang disimpan; "tolak" selalu ditanyakan ulang.
 */
export class ApprovalRules {
  private rules: ApprovalRule[] = [];

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const parsed = FileSchema.safeParse(JSON.parse(await fs.readFile(this.file, 'utf8')));
      this.rules = parsed.success ? parsed.data.rules : [];
    } catch {
      this.rules = [];
    }
  }

  list(projectId: string): ApprovalRule[] {
    return this.rules.filter((r) => r.projectId === projectId);
  }

  matches(projectId: string, kind: RuleKind, detail: string): boolean {
    const normalized = normalizeDetail(detail);
    return this.rules.some(
      (r) =>
        r.projectId === projectId &&
        r.kind === kind &&
        (r.pattern === '*' || r.pattern === normalized),
    );
  }

  async add(projectId: string, kind: RuleKind, detail: string): Promise<ApprovalRule> {
    const rule: ApprovalRule = {
      projectId,
      kind,
      pattern: kind === 'file_write' ? '*' : normalizeDetail(detail),
    };
    if (
      !this.rules.some(
        (r) => r.projectId === projectId && r.kind === kind && r.pattern === rule.pattern,
      )
    ) {
      this.rules.push(rule);
      await this.save();
    }
    return rule;
  }

  async remove(projectId: string): Promise<void> {
    this.rules = this.rules.filter((r) => r.projectId !== projectId);
    await this.save();
  }

  private async save(): Promise<void> {
    await fs.mkdir(nodePath.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ version: 1, rules: this.rules }, null, 2));
    await fs.rename(temp, this.file);
  }
}
