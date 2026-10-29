import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Lint desain statis (Fase 24): menegakkan daftar larangan anti AI slop dan aturan token dari
 * docs/DESIGN_SYSTEM.md pada seluruh kode UI desktop. Pelanggaran baru membuat tes ini gagal.
 */
const SRC = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'fonts' ? [] : files(full);
    return /\.(tsx|ts|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const sources = files(SRC).map((file) => ({
  file: path.relative(SRC, file).replaceAll('\\', '/'),
  text: readFileSync(file, 'utf8'),
}));

/** Baris kode (tanpa komentar) tempat pola cocok, untuk pesan galat yang bisa ditindaklanjuti. */
function hits(pattern: RegExp, only?: RegExp): string[] {
  return sources
    .filter((s) => !only || only.test(s.file))
    .flatMap(({ file, text }) =>
      text.split('\n').flatMap((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (/^\s*\*/.test(line)) return [];
        return pattern.test(code) ? [`${file}:${i + 1}: ${line.trim().slice(0, 100)}`] : [];
      }),
    );
}

/* ---------- Aturan desain Sesi 1 (docs/DESIGN_SYSTEM.md): blur, gradien, durasi, font, radius ---------- */

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const cssText = [
  ...sources.filter((s) => s.file.endsWith('.css')).map((s) => s.text),
  readFileSync(path.resolve(SRC, '../../../packages/ui-tokens/tokens.css'), 'utf8'),
]
  .map(stripComments)
  .join('\n');
const stylesCss = stripComments(sources.find((s) => s.file === 'styles.css')?.text ?? '');

/** Lapisan melayang tempat blur boleh dipakai: palet perintah, toast, header lengket, panel samping yang menimpa. */
const FLOATING_LAYERS = [
  'shell/CommandPalette.tsx',
  'ui/Toaster.tsx',
  'shell/RightPanel.tsx',
  'shell/Shell.tsx',
];
const BLUR_MAX_PX = 16;

const GRADIENT_TOKEN =
  /^(?:accent|accent-2|accent-soft|on-accent|(?:thinking|tool|writing|done|error)(?:-soft|-on)?)$/;
const LITERAL_COLOR =
  /#[0-9a-fA-F]{3,8}\b|\b(?:oklch|oklab|rgba?|hsla?|hwb|lab|lch)\(|\b(?:white|black|red|green|blue|purple|violet|pink|orange|yellow|gray|grey)\b/;

/** Ekspresi gradien lengkap (kurung seimbang, lintas baris). */
function gradients(text: string): string[] {
  const found: string[] = [];
  const start = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/g;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    let depth = 1;
    let i = start.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    found.push(text.slice(m.index, i));
  }
  return found;
}

/** Alasan gradien melanggar: warna di luar token status/aksen, atau warna literal. */
function gradientProblems(gradient: string): string[] {
  const problems = [...gradient.matchAll(/var\(--aios-([\w-]+)\)/g)]
    .map((m) => m[1] ?? '')
    .filter((name) => !GRADIENT_TOKEN.test(name))
    .map((name) => `token bukan status/aksen: --aios-${name}`);
  if (LITERAL_COLOR.test(gradient)) problems.push('warna literal');
  return problems;
}

const TIME = /^-?\d*\.?\d+(?:ms|s)$/;
const toMs = (t: string) => (t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000);
const DURATIONS_MS = [80, 120, 180, 240, 320, 420, 640];
const LOOP_MIN_MS = 1400;

function splitTop(value: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && sep.test(ch)) {
      if (current) parts.push(current);
      current = '';
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/** Pelanggaran durasi pada satu nilai `animation`/`transition`/`*-duration`. */
function durationProblems(prop: string, value: string): string[] {
  const problems: string[] = [];
  for (const segment of splitTop(value, /,/)) {
    const tokens = splitTop(segment.trim(), /\s/);
    const times = tokens.filter((t) => TIME.test(t));
    // Shorthand: waktu pertama = durasi, kedua = jeda. `*-duration`: semua waktu adalah durasi.
    const durations = prop.endsWith('duration') ? times : times.slice(0, 1);
    const infinite = tokens.includes('infinite');
    for (const t of durations) {
      const ms = toMs(t);
      if (t === '1ms') continue; // blok prefers-reduced-motion
      if (infinite ? ms < LOOP_MIN_MS : !DURATIONS_MS.includes(ms)) {
        problems.push(`${prop}: ${t}${infinite ? ' (tak berhingga: min 1400ms)' : ''}`);
      }
    }
    const loopDuration = tokens.find((t) => TIME.test(t) || t.startsWith('var(--aios-'));
    if (
      infinite &&
      !prop.endsWith('duration') &&
      loopDuration?.startsWith('var(--aios-') &&
      loopDuration !== 'var(--aios-loop-min)'
    ) {
      problems.push(
        `${prop}: tak berhingga harus ≥1400ms atau var(--aios-loop-min), bukan ${loopDuration}`,
      );
    }
  }
  return problems;
}

function motionDeclarations(text: string): { prop: string; value: string }[] {
  return [
    ...text.matchAll(
      /(?:^|[;{\s])(--animate-[\w-]+|animation-duration|transition-duration|animation|transition)\s*:\s*([^;}]+)/g,
    ),
  ].map((m) => ({
    prop: m[1] ?? '',
    value: (m[2] ?? '')
      .replace(/!important/, '')
      .replace(/['"`]/g, '')
      .trim(),
  }));
}

const FONT_FAMILIES = [
  'geist',
  'geist mono',
  'ibm plex sans',
  'ibm plex mono',
  'sans-serif',
  'monospace',
];
const RADIUS_PX = [8, 12, 16, 24];
const RADIUS_NAMES = ['sm', 'md', 'lg', 'xl', 'badge', 'control', 'panel', 'sheet'];

describe('lint desain', () => {
  it('ada kode UI yang dipindai', () => {
    expect(sources.length).toBeGreaterThan(80);
  });

  it('tanpa warna tetap (hex, rgb, hsl) di komponen: hanya token', () => {
    expect(hits(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/, /\.tsx$/)).toEqual([]);
  });

  it('tanpa warna Tailwind bawaan atau nilai warna sembarang (bg-red-500, text-[#fff])', () => {
    expect(
      hits(
        /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?\b|-\[#/,
        /\.tsx$/,
      ),
    ).toEqual([]);
  });

  it('tanpa utilitas gradien/blur/pantul bawaan Tailwind di komponen', () => {
    expect(
      hits(
        /\b(?:bg-gradient|bg-linear|bg-radial|bg-conic|from-|via-|backdrop-|blur-|animate-bounce|animate-ping)/,
        /\.tsx$/,
      ),
    ).toEqual([]);
    expect(
      hits(/linear-gradient|radial-gradient|conic-gradient|backdrop-filter/, /\.tsx$/),
    ).toEqual([]);
  });

  it('gradien hanya dari token status dan aksen (tanpa warna literal atau token lain)', () => {
    const all = gradients(cssText);
    expect(all.length).toBeGreaterThan(0);
    expect(all.flatMap((g) => gradientProblems(g).map((p) => `${p} :: ${g.slice(0, 80)}`))).toEqual(
      [],
    );
  });

  it('pemeriksa gradien menolak token di luar status/aksen dan warna literal', () => {
    expect(gradientProblems('linear-gradient(90deg, var(--aios-accent), transparent)')).toEqual([]);
    expect(
      gradientProblems(
        'linear-gradient(90deg, var(--aios-thinking), color-mix(in oklch, var(--aios-done) 20%, transparent))',
      ),
    ).toEqual([]);
    expect(
      gradientProblems('linear-gradient(90deg, var(--aios-surface-2), var(--aios-accent))'),
    ).toHaveLength(1);
    expect(
      gradientProblems('linear-gradient(90deg, var(--aios-accent), oklch(0.7 0.2 300))'),
    ).toEqual(['warna literal']);
    expect(gradientProblems('linear-gradient(90deg, #fff, var(--aios-accent))')).toEqual([
      'warna literal',
    ]);
  });

  it('blur hanya lewat .aios-blur (maks 16px), dan kelas itu hanya di lapisan melayang', () => {
    const rules = [...cssText.matchAll(/([^{}]+)\{([^{}]*backdrop-filter[^{}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    const blurVar = /--aios-blur\s*:\s*(\d+)px/.exec(cssText)?.[1];
    expect(Number(blurVar)).toBeGreaterThan(0);
    for (const [, selector = '', body = ''] of rules) {
      expect(selector.trim(), 'backdrop-filter hanya di .aios-blur').toBe('.aios-blur');
      for (const m of body.matchAll(/blur\((var\(--aios-blur\)|[^)]+)\)/g)) {
        const arg = (m[1] ?? '').trim();
        const px = arg === 'var(--aios-blur)' ? Number(blurVar) : parseFloat(arg);
        expect(px, `blur(${arg})`).toBeLessThanOrEqual(BLUR_MAX_PX);
      }
    }
    const users = sources.filter((s) => /\baios-blur\b/.test(s.text) && /\.tsx$/.test(s.file));
    expect(users.map((s) => s.file).filter((f) => !FLOATING_LAYERS.includes(f))).toEqual([]);
    // Tidak pernah di belakang teks isi jawaban.
    expect(
      users.map((s) => s.file).filter((f) => f.startsWith('chat/') || f.startsWith('markdown/')),
    ).toEqual([]);
  });

  it('lapisan melayang yang diizinkan ada dan bukan bagian isi jawaban', () => {
    for (const f of FLOATING_LAYERS)
      expect(
        sources.some((s) => s.file === f),
        f,
      ).toBe(true);
  });

  it('tanpa emoji di UI (ikon hanya Lucide)', () => {
    expect(
      hits(/\p{Extended_Pictographic}/u, /\.tsx?$/).filter((l) => !l.includes('copy.ts')),
    ).toEqual([]);
  });

  it('ukuran teks hanya dari skala (caption, meta, ui, chat, section, page); tanpa text-[Npx] atau text-lg', () => {
    expect(hits(/\btext-(?:\[\d|xs\b|sm\b|base\b|lg\b|xl\b|\dxl\b)/, /\.tsx$/)).toEqual([]);
  });

  it('radius hanya himpunan 8/12/16/24 px: kelas rounded-* dari token, bulat penuh, atau nol', () => {
    const allowed =
      /^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee))?-(?:badge|control|panel|sheet|sm|md|lg|xl|full|none)$/;
    const bad = sources
      .filter((s) => /\.tsx$/.test(s.file))
      .flatMap(({ file, text }) =>
        [...text.matchAll(/(?<![\w-])rounded[\w[\]./%-]*/g)]
          .map((m) => m[0])
          .filter((c) => !allowed.test(c))
          .map((c) => `${file}: ${c}`),
      );
    expect(bad).toEqual([]);
  });

  it('nama radius token bernilai 8/12/16/24 px dan palet radius bawaan Tailwind dimatikan', () => {
    expect(cssText).toContain('--radius-*: initial;');
    for (const name of RADIUS_NAMES) {
      const value = new RegExp(`--radius-${name}\\s*:\\s*(\\d+)px`).exec(cssText)?.[1];
      expect(RADIUS_PX, `--radius-${name}`).toContain(Number(value));
    }
    const literal = [...stylesCss.matchAll(/border-radius\s*:\s*([^;}]+)/g)].map((m) => m[1] ?? '');
    expect(
      literal.filter((v) => !/^(?:var\(--|\d+px\b|0\b|50%|9999px|inherit)/.test(v.trim())),
    ).toEqual([]);
    const px = literal.flatMap((v) => [...v.matchAll(/(\d+)px/g)].map((m) => Number(m[1])));
    expect(px.filter((n) => !RADIUS_PX.includes(n) && n !== 9999)).toEqual([]);
  });

  it('bayangan hanya token shadow-float (menu, popover, dialog, toast), shadow-layer-1..3 dan efek glow/lift', () => {
    const bad = hits(/\bshadow-(?!(?:float|glow|lift|layer-[123])\b)[a-z0-9]+/, /\.tsx$/).concat(
      hits(/\bshadow(?![-\w])/, /\.tsx$/),
    );
    expect(bad).toEqual([]);
  });

  it('durasi hanya 80/120/180/240/320/420/640 ms; animasi tak berhingga minimal 1400 ms', () => {
    const tailwind = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/duration-\[(\d+)ms\]/g)].map((m) => ({ file, ms: Number(m[1]) })),
    );
    expect(tailwind.length).toBeGreaterThan(0);
    expect(tailwind.filter((d) => !DURATIONS_MS.includes(d.ms))).toEqual([]);
    expect(hits(/\bduration-(?:\d+)\b|\bease-(?:in|out|in-out|linear)\b/, /\.tsx$/)).toEqual([]);

    const declared = sources
      .filter((s) => /\.(tsx|css)$/.test(s.file))
      .flatMap(({ file, text }) =>
        motionDeclarations(stripComments(text)).flatMap(({ prop, value }) =>
          durationProblems(prop, value).map((p) => `${file}: ${p}`),
        ),
      );
    expect(declared).toEqual([]);
  });

  it('pemeriksa durasi menolak 150 ms, 1 detik tak berhingga, dan menerima himpunan baru', () => {
    expect(durationProblems('transition', 'opacity 80ms ease, transform 640ms ease')).toEqual([]);
    expect(durationProblems('animation', 'x 0.42s linear 3s')).toEqual([]);
    expect(durationProblems('transition', 'opacity 150ms')).toHaveLength(1);
    expect(durationProblems('animation', 'x 1s infinite')).toHaveLength(1);
    expect(durationProblems('animation', 'x 1400ms infinite')).toEqual([]);
    expect(durationProblems('animation', 'x var(--aios-duration-base) infinite')).toHaveLength(1);
    expect(durationProblems('animation', 'x var(--aios-loop-min) infinite')).toEqual([]);
  });

  it('animasi tak berhingga berhenti di prefers-reduced-motion', () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(stylesCss)?.[1] ?? '';
    expect(block).toContain('animation-iteration-count: 1');
    expect(block).toContain('animation: none');
  });

  it('font hanya Geist, Geist Mono, dan IBM Plex (cadangan); tanpa font-serif atau keluarga lain', () => {
    expect(hits(/\bfont-serif\b/, /\.tsx$/)).toEqual([]);
    const declared = sources
      .filter((s) => /\.(tsx|css)$/.test(s.file))
      .flatMap(({ file, text }) =>
        [
          ...stripComments(text).matchAll(
            /(?:font-family|fontFamily|--font-(?:sans|mono))\s*:\s*(['"`]?)([^;\n}]+)/g,
          ),
        ].flatMap((m) =>
          (m[2] ?? '')
            .replace(/[,\s]*['"`]?,?\s*$/, '')
            .split(',')
            .map((f) =>
              f
                .trim()
                .replace(/^['"`]|['"`]$/g, '')
                .toLowerCase(),
            )
            .filter((f) => f && !FONT_FAMILIES.includes(f))
            .map((f) => `${file}: ${f}`),
        ),
      );
    expect(declared).toEqual([]);
  });

  it('Geist di-self-host (woff2 + lisensi OFL) dan tidak lewat paket npm', () => {
    const urls = [...stylesCss.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)].map((m) => m[1] ?? '');
    const geist = urls.filter((u) => u.startsWith('Geist'));
    expect(geist.length).toBeGreaterThanOrEqual(2);
    for (const u of geist) {
      expect(u.endsWith('.woff2'), u).toBe(true);
      expect(existsSync(path.join(SRC, 'fonts', u)), u).toBe(true);
    }
    expect(existsSync(path.join(SRC, 'fonts', 'OFL-Geist.txt'))).toBe(true);
    const pkg = readFileSync(path.resolve(SRC, '../package.json'), 'utf8');
    expect(pkg).not.toMatch(/"(?:geist|@fontsource[^"]*)"/);
  });

  it('tombol ikon punya nama untuk pembaca layar: IconButton selalu mewajibkan label', () => {
    const iconButton = sources.find((s) => s.file === 'ui/IconButton.tsx')?.text ?? '';
    expect(iconButton).toMatch(/label: string/);
    expect(iconButton).toMatch(/aria-label=\{label\}/);
  });
});
