import { promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { aiosToolOf, connectorToolOf } from '@aios/contracts';
import { z } from 'zod';

const RuleSchema = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['command', 'file_write', 'network']),
  /**
   * Perintah/URL persis (spasi dinormalkan), `*` untuk semua penulisan file di worktree, nama tool gateway
   * (`mcp__aios_tools_web_search`), atau nama tool konektor (`mcp__konektor_github_create_issue`) untuk semua
   * panggilan tool itu.
   */
  pattern: z.string().min(1),
});
export type ApprovalRule = z.infer<typeof RuleSchema>;

const FileSchema = z.object({ version: z.literal(1), rules: z.array(RuleSchema) });

export type RuleKind = ApprovalRule['kind'];

/** Spasi berulang dan ujung dirapikan; huruf tidak diubah (perintah membedakan huruf besar/kecil). */
export const normalizeDetail = (detail: string): string => detail.trim().replace(/\s+/g, ' ');

/**
 * Pola aturan dari permintaan izin. Tool gateway (`aios_tools`) dan tool konektor diingat per nama tool, karena
 * detailnya memuat argumen (kueri, URL, badan isu) yang hampir tidak pernah sama; gateway tetap membatasi apa
 * yang boleh dibuka dan konektor mana yang hidup. Untuk konektor polanya mencakup slug konektor sekaligus nama
 * tool (`mcp__konektor_<slug>_<tool>`), jadi izin satu tool tidak pernah berlaku untuk tool atau konektor lain.
 * Nama `mcp__*` di luar konektor terdaftar tetap memakai detail penuh seperti sebelumnya.
 */
function patternOf(kind: RuleKind, detail: string): string {
  if (kind === 'file_write') return '*';
  const tool = detail.split('\n')[0]?.trim() ?? '';
  return aiosToolOf(tool) || connectorToolOf(tool) ? tool : normalizeDetail(detail);
}

/** Skrip package manager: `npm test`, `npm run <skrip>`, `pnpm test|run <skrip>`, `yarn test|run <skrip>`, `bun run <skrip>`. */
const PACKAGE_SCRIPT =
  /^(?:npm (?:test|t|run [\w:.-]+)|(?:pnpm|yarn) (?:test|run [\w:.-]+)|bun run [\w:.-]+)$/;
/** Argumen tambahan yang aman: literal tanpa metakarakter shell, kutip, atau ekspansi. */
const PLAIN_ARGS = /^[\w@%+=:,./-]+(?: [\w@%+=:,./-]+)*$/;

/**
 * "Selalu" untuk skrip package manager mencakup argumen tambahan setelah `--`: `npm test` juga mengizinkan
 * `npm test -- --run src/x.test.ts` (uji project: izin berulang tiap tes dijalankan per berkas). Aman karena yang
 * dijalankan tetap skrip project yang sama yang sudah diizinkan selalu (skrip itu sendiri sudah menjalankan kode
 * project apa pun); argumen setelah `--` hanya diteruskan ke skrip, bukan opsi package manager seperti `--prefix`
 * yang bisa memindahkan folder. Perintah lain (mis. `git push`, `rm`) tetap cocok persis, karena argumen tambahan
 * di sana mengubah tindakannya.
 */
function extendsScript(rule: string, command: string): boolean {
  if (!PACKAGE_SCRIPT.test(rule) || !command.startsWith(`${rule} -- `)) return false;
  return PLAIN_ARGS.test(command.slice(rule.length + 4));
}

/**
 * Aturan "selalu izinkan untuk project ini" (SECURITY_OPS.md). Omp tidak punya aturan permanen per pola
 * (docs/VERIFICATION.md), jadi disimpan di worker dan dijawab otomatis di sini. Sengaja sempit:
 * - perintah dan URL: cocok persis, bukan awalan, jadi `pnpm test` tidak membuka `pnpm test && rm -rf`. Satu
 *   pengecualian: skrip package manager mencakup argumen literal setelah `--` (lihat `extendsScript`).
 * - penulisan file: seluruh penulisan agent di folder kerja run project itu, bukan `.git` (diperiksa coordinator).
 * - tool gateway (web_search, web_read): per nama tool; batas URL dan kueri ditegakkan gateway.
 * - tool konektor: per konektor dan per nama tool, tidak pernah per argumen (DESIGN_MCP_KONEKTOR.md #6);
 *   allowlist tool, anggaran, dan mode rencana tetap ditegakkan gateway.
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
    const pattern = patternOf(kind, detail);
    return this.rules.some(
      (r) =>
        r.projectId === projectId &&
        r.kind === kind &&
        (r.pattern === '*' ||
          r.pattern === pattern ||
          (kind === 'command' && extendsScript(r.pattern, pattern))),
    );
  }

  async add(projectId: string, kind: RuleKind, detail: string): Promise<ApprovalRule> {
    const rule: ApprovalRule = { projectId, kind, pattern: patternOf(kind, detail) };
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
