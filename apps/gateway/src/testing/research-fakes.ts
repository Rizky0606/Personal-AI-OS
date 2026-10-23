/**
 * Pengganti SearXNG, halaman web, dan model untuk tes riset. Balasan model dihasilkan dari isi prompt
 * pipeline (rencana, ringkasan, laporan, perbaikan), sehingga nomor rujukan di laporan palsu mengikuti
 * daftar sumber yang benar-benar dikirim pipeline.
 */

export interface FakeSite {
  url: string;
  title: string;
  html: string;
}

const SENTENCE =
  'Penjualan kendaraan listrik di kawasan ini naik tajam karena insentif pajak, harga baterai yang turun, dan bertambahnya stasiun pengisian daya umum.';

/** Halaman artikel dengan noise (navigasi, iklan, skrip) di sekelilingnya. */
export function articleHtml(
  title: string,
  options: { paragraphs?: number; published?: string } = {},
): string {
  const paragraphs = options.paragraphs ?? 6;
  return `<!doctype html><html lang="id"><head><title>${title} | Situs</title>
${options.published ? `<meta property="article:published_time" content="${options.published}">` : ''}
<script>window.track = 'JANGAN-MASUK-LAPORAN'</script></head><body>
<nav><a href="/">Beranda</a> MENU-NAVIGASI</nav>
<article><h1>${title}</h1>
${Array.from({ length: paragraphs }, (_, i) => `<p>${title} — bagian ${i + 1}. ${SENTENCE}</p>`).join('\n')}
</article><aside>IKLAN-SAMPING</aside><footer>FOOTER-SITUS</footer></body></html>`;
}

/** n situs berbeda domain (site1.example, site2.example, ...). */
export function makeSites(count: number, prefix = 'Sumber'): FakeSite[] {
  return Array.from({ length: count }, (_, i) => {
    const title = `${prefix} ${i + 1} tentang kendaraan listrik`;
    return {
      url: `https://site${i + 1}.example/artikel-${i + 1}`,
      title,
      html: articleHtml(title, { published: '2026-01-15' }),
    };
  });
}

export interface ScriptedLlmOptions {
  /**
   * `good`: semua klaim berumpun; `uncited`: satu paragraf tanpa rujukan; `invalidRef`: ada [99];
   * `fenced`: laporan dibungkus ```markdown; `noRefs`: tidak ada rujukan sama sekali.
   */
  mode?: 'good' | 'uncited' | 'invalidRef' | 'fenced' | 'noRefs';
  /** Apakah permintaan perbaikan benar-benar memperbaiki (laporan baik) atau tidak (mengulang yang sama). */
  repairFixes?: boolean;
  /** Rencana: `bad` selalu balasan rusak. */
  plan?: 'good' | 'bad';
  /** Dipanggil untuk setiap permintaan (menghitung dan memeriksa prompt). */
  onCall?: (kind: LlmKind, request: LlmRequest) => void;
}

export type LlmKind = 'plan' | 'summary' | 'synthesis' | 'repair';

export interface LlmRequest {
  model: string;
  system?: string | undefined;
  user: string;
}

export function classify(request: LlmRequest): LlmKind {
  if (request.system?.includes('perencana riset')) return 'plan';
  if (request.system?.includes('peringkas sumber')) return 'summary';
  if (request.user.startsWith('Perbaiki laporan')) return 'repair';
  return 'synthesis';
}

function sourceNumbers(user: string): number[] {
  return [...user.matchAll(/^\[(\d+)\] .+? — /gm)].map((m) => Number(m[1]));
}

function subQuestionsOf(user: string): string[] {
  const block = /Sub-pertanyaan:\n([\s\S]*?)\n\nSumber:/.exec(user)?.[1] ?? '';
  return block
    .split('\n')
    .map((l) => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

export function buildReport(user: string, mode: NonNullable<ScriptedLlmOptions['mode']>): string {
  const numbers = sourceNumbers(user);
  const last = numbers.at(-1) ?? 1;
  const first = numbers[0] ?? 1;
  const subs = subQuestionsOf(user);
  const cite = (...ns: number[]) =>
    mode === 'noRefs' ? '' : ` ${ns.map((n) => `[${n}]`).join('')}`;
  const lines = [
    '# Laporan riset kendaraan listrik',
    '## Ringkasan',
    // Sengaja mengutip sumber TERAKHIR lebih dulu, supaya penomoran ulang terbukti bekerja.
    `Temuan utama menunjukkan penjualan kendaraan listrik meningkat tajam di kawasan ini${cite(last, first)}.`,
    ...subs.flatMap((sub, i) => [
      `## ${i + 1}. ${sub}`,
      mode === 'uncited' && i === 0
        ? 'Paragraf ini membuat klaim penting tentang pangsa pasar tetapi lupa mencantumkan sumbernya sama sekali.'
        : `Jawaban untuk sub-pertanyaan ${i + 1} menyebut insentif pajak dan harga baterai sebagai pendorong utama${cite(numbers[i % numbers.length] ?? first)}.`,
    ]),
    ...(mode === 'invalidRef'
      ? ['## Tambahan', 'Klaim ini merujuk nomor sumber yang tidak pernah ada dalam daftar [99].']
      : []),
    '## Batasan dan ketidakpastian',
    'Cakupan sumber terbatas pada media daring yang dapat diakses publik.',
  ];
  const report = lines.join('\n\n');
  return mode === 'fenced' ? `\`\`\`markdown\n${report}\n\`\`\`` : report;
}

/** Balasan model palsu untuk satu permintaan. */
export function scriptedLlmReply(request: LlmRequest, options: ScriptedLlmOptions = {}): string {
  const kind = classify(request);
  options.onCall?.(kind, request);
  const mode = options.mode ?? 'good';

  if (kind === 'plan') {
    if (options.plan === 'bad') return 'maaf, saya tidak bisa membuat rencana';
    const count = Number(/tepat (\d+) sub-pertanyaan/.exec(request.user)?.[1] ?? 5);
    return JSON.stringify({
      subQuestions: Array.from(
        { length: count },
        (_, i) => `Bagaimana aspek nomor ${i + 1} dari kendaraan listrik berkembang?`,
      ),
    });
  }
  if (kind === 'summary') {
    const title = /Halaman: (.*?) \(https?:/.exec(request.user)?.[1] ?? 'halaman';
    if (title.includes('IRELEVAN'))
      return JSON.stringify({ relevant: false, summary: '', publishedAt: null, subQuestions: [] });
    return JSON.stringify({
      relevant: true,
      summary: `Ringkasan fakta dari ${title}: penjualan naik tajam, insentif pajak berlaku, dan harga baterai turun.`,
      publishedAt: '2026-01-15',
      subQuestions: [1, 2],
    });
  }
  if (kind === 'repair') {
    if (options.repairFixes) return buildReport(request.user, 'good');
    return /Laporan:\n([\s\S]*)$/.exec(request.user)?.[1] ?? '';
  }
  return buildReport(request.user, mode);
}
