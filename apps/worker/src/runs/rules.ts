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

/**
 * Spasi/tab berulang dan ujung dirapikan; huruf tidak diubah (perintah membedakan huruf besar/kecil). Baris baru
 * dipertahankan: bagi shell, baris baru memisahkan perintah, jadi `a\nb` bukan perintah yang sama dengan `a b`.
 */
export const normalizeDetail = (detail: string): string =>
  detail
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim();

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
/** Path relatif di dalam folder kerja: bukan absolut, tanpa huruf drive atau `~` (segmen `..` diperiksa terpisah). */
const RELATIVE = /^[\w@%+,.-][\w@%+,./-]*$/;

/**
 * Satu argumen tambahan yang aman: opsi panjang (`--run`, `--reporter=verbose`) dengan nilai relatif, gabungan opsi
 * pendek tanpa nilai menempel (`-t`, `-u`), atau path/nama relatif. Nilai absolut atau yang keluar folder
 * (`--outputFile=/home/u/x`, `--outDir ../x`, `-o/tmp/x`) membuat perintah ditanyakan.
 */
function safeScriptArg(arg: string): boolean {
  const long = /^--[\w-]+(?:=(.+))?$/.exec(arg);
  if (arg.startsWith('-') && !long) return /^-[A-Za-z]+$/.test(arg);
  const value = long ? long[1] : arg;
  return value === undefined || (RELATIVE.test(value) && !value.split('/').includes('..'));
}

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
  const args = command.slice(rule.length + 4);
  // Baris baru, tab, kutip, dan metakarakter shell tidak lolos `safeScriptArg`; hanya spasi tunggal pemisah.
  return args.split(' ').every(safeScriptArg);
}

/**
 * Skrip package manager polos dari `<skrip> -- <argumen aman>` (mis. `npm test -- --run` → `npm test`); undefined
 * bila perintah bukan bentuk itu atau argumennya tidak lolos `safeScriptArg`. "Selalu" yang ditekan pada perintah
 * seperti itu disimpan sebagai skrip polosnya (uji project N5): skrip yang sama dengan argumen aman lain setara
 * dengan yang sudah diizinkan, jadi tidak ditanyakan lagi per berkas tes. Argumen yang tidak aman (path absolut,
 * `..`, metakarakter shell) membuat aturan tetap cocok persis.
 */
function scriptBase(command: string): string | undefined {
  const at = command.indexOf(' -- ');
  if (at < 0) return undefined;
  const base = command.slice(0, at);
  return extendsScript(base, command) ? base : undefined;
}

/**
 * Aturan "selalu izinkan untuk project ini" (SECURITY_OPS.md). Omp tidak punya aturan permanen per pola
 * (docs/VERIFICATION.md), jadi disimpan di worker dan dijawab otomatis di sini. Sengaja sempit:
 * - perintah dan URL: cocok persis, bukan awalan, jadi `pnpm test` tidak membuka `pnpm test && rm -rf`. Satu
 *   pengecualian: skrip package manager mencakup argumen literal yang aman setelah `--` (lihat `extendsScript`),
 *   dan "Selalu" pada skrip dengan argumen aman disimpan sebagai skrip polosnya (lihat `scriptBase`).
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
    return this.rules.some((r) => {
      if (r.projectId !== projectId || r.kind !== kind) return false;
      if (r.pattern === '*' || r.pattern === pattern) return true;
      if (kind !== 'command') return false;
      // Aturan lama yang tersimpan dengan argumen (sebelum `scriptBase`) berlaku seperti skrip polosnya.
      const script = scriptBase(r.pattern) ?? r.pattern;
      return script === pattern || extendsScript(script, pattern);
    });
  }

  async add(projectId: string, kind: RuleKind, detail: string): Promise<ApprovalRule> {
    const pattern = patternOf(kind, detail);
    const rule: ApprovalRule = {
      projectId,
      kind,
      pattern: (kind === 'command' ? scriptBase(pattern) : undefined) ?? pattern,
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
