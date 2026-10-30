import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, inSrgbGamut, oklchToSrgb8, toHex } from './color.js';
import { generateCss, springLinear } from './css.js';
import { generateKotlin } from './kotlin.js';
import { COLOR_NAMES, STATUS_NAMES, TokensSchema, loadTokens, type ColorName } from './tokens.js';

const tokens = loadTokens();
const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('tokens.json', () => {
  it('memuat 31 warna di tema terang dan gelap: 14 inti, 2 lapisan permukaan, 5 status x 3 varian', () => {
    expect(COLOR_NAMES).toHaveLength(31);
    expect(STATUS_NAMES).toEqual(['thinking', 'tool', 'writing', 'done', 'error']);
    for (const s of STATUS_NAMES) {
      for (const v of [s, `${s}-soft`, `${s}-on`]) expect(COLOR_NAMES).toContain(v);
    }
    for (const n of ['surface-1', 'surface-3']) expect(COLOR_NAMES).toContain(n);
    expect(Object.keys(tokens.color.light).sort()).toEqual([...COLOR_NAMES].sort());
    expect(Object.keys(tokens.color.dark).sort()).toEqual([...COLOR_NAMES].sort());
  });

  it('spasi kelipatan 4 sesuai DESIGN_SYSTEM.md', () => {
    expect(tokens.space).toEqual([4, 8, 12, 16, 20, 24, 32, 40, 48]);
  });

  it('radius 8/12/16/24 di desktop dan Android; gerak 80/120/180/240/320/420/640 ms', () => {
    expect(tokens.radius.desktop).toEqual({ sm: 8, md: 12, lg: 16, xl: 24 });
    expect(tokens.radius.android).toEqual({ sm: 8, md: 12, lg: 16, xl: 24 });
    expect(tokens.motion.duration).toEqual({
      instant: 80,
      fast: 120,
      base: 180,
      slow: 240,
      emphasis: 320,
      long: 420,
      extra: 640,
    });
    // Pegas ringan: overshoot kecil (y1 sedikit di atas 1), bukan pantulan.
    expect(tokens.motion.spring[1]).toBeGreaterThan(1);
    expect(tokens.motion.spring[1]).toBeLessThan(1.5);
    expect(tokens.motion.easing).toEqual([0.2, 0, 0, 1]);
    // Pegas fisik untuk elemen yang berpindah posisi, dan siklus minimum animasi tak berhingga.
    expect(tokens.motion.springMove).toEqual({ dampingRatio: 0.7, stiffness: 300 });
    expect(tokens.motion.loopMinMs).toBe(1400);
  });

  it('font: Geist dan Geist Mono, IBM Plex sebagai cadangan', () => {
    expect(tokens.font.family).toEqual({
      sans: 'Geist',
      mono: 'Geist Mono',
      fallback: { sans: 'IBM Plex Sans', mono: 'IBM Plex Mono' },
    });
  });

  it('lapisan permukaan: tiga bayangan tipis per tema dan tiga elevasi Android yang naik', () => {
    expect(tokens.shadow.layers).toHaveLength(3);
    expect(tokens.shadow.androidLayers).toEqual([1, 2, 4]);
  });

  it('layout desktop (shell pulau): sidebar 232 dan ringkas 64, topbar 48, jarak pulau 8, lebar halaman satu token', () => {
    expect(tokens.layout.desktop).toEqual({
      sidebar: 232,
      sidebarCompact: 64,
      topbar: 48,
      statusBar: 24,
      header: 48,
      row: 32,
      islandGap: 8,
      pageMeasure: 720,
    });
    const css = generateCss(tokens);
    for (const [name, px] of [
      ['sidebar-width', 232],
      ['sidebar-compact-width', 64],
      ['topbar-height', 48],
      ['statusbar-height', 24],
      ['row-height', 32],
      ['island-gap', 8],
      ['page-measure', 720],
    ] as const) {
      expect(css).toContain(`--aios-${name}: ${px}px`);
    }
  });

  it('skala tipografi sesuai tabel (desktop px, Android sp)', () => {
    const sizes = Object.fromEntries(
      Object.entries(tokens.type).map(([k, v]) => [k, [v.desktop.size, v.android.size]]),
    );
    expect(sizes).toEqual({
      caption: [11, 12],
      meta: [12, 13],
      ui: [13, 14],
      chat: [14, 16],
      section: [16, 18],
      page: [20, 22],
    });
  });

  it('menolak warna yang bukan oklch, warna hilang, dan spasi bukan kelipatan 4', () => {
    const badColor = structuredClone(tokens);
    badColor.color.light.bg = '#ffffff';
    expect(TokensSchema.safeParse(badColor).success).toBe(false);

    const missing = structuredClone(tokens) as unknown as {
      color: { dark: Record<string, string> };
    };
    delete missing.color.dark.info;
    expect(TokensSchema.safeParse(missing).success).toBe(false);

    const badSpace = structuredClone(tokens);
    badSpace.space = [4, 10];
    expect(TokensSchema.safeParse(badSpace).success).toBe(false);
  });
});

describe('konversi warna', () => {
  it('OKLCH putih dan hitam menjadi FFFFFF dan 000000', () => {
    expect(toHex('oklch(1 0 0)')).toBe('FFFFFF');
    expect(toHex('oklch(0 0 0)')).toBe('000000');
  });

  it.each([
    ['merah primer sRGB', 'oklch(0.62796 0.25768 29.23)', 'FF0000'],
    ['hijau primer sRGB', 'oklch(0.86644 0.29483 142.5)', '00FF00'],
    ['biru primer sRGB', 'oklch(0.45201 0.31321 264.05)', '0000FF'],
  ])('titik acuan kanonik: %s', (_name, oklch, hex) => {
    const got = oklchToSrgb8(oklch);
    const want = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    got.forEach((v, i) => expect(Math.abs(v - (want[i] ?? 0))).toBeLessThanOrEqual(2));
  });

  it('rasio kontras hitam-putih adalah 21', () => {
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 1);
  });
});

describe('kontras WCAG AA', () => {
  type Pair = [ColorName, ColorName];

  /** Teks harus >= 4.5; elemen UI non-teks (ikon, cincin fokus) >= 3. */
  const textPairs: Pair[] = [
    ['text', 'surface-1'],
    ['text', 'surface-3'],
    ['text-2', 'surface-1'],
    ['text-2', 'surface-3'],
    ['text-3', 'surface-1'],
    ['text-3', 'surface-3'],
    ...STATUS_NAMES.flatMap((s): Pair[] => [
      [`${s}-on` as ColorName, s as ColorName],
      ['text', `${s}-soft` as ColorName],
      ['text-2', `${s}-soft` as ColorName],
    ]),
    ['text', 'bg'],
    ['text', 'surface'],
    ['text', 'surface-2'],
    ['text-2', 'bg'],
    ['text-2', 'surface'],
    ['text-2', 'surface-2'],
    ['text-3', 'bg'],
    ['text-3', 'surface'],
    ['text-3', 'surface-2'],
    ['text', 'accent-soft'],
    ['danger', 'surface'],
  ];
  const uiPairs: Pair[] = [
    ...STATUS_NAMES.flatMap((s): Pair[] => [
      [s as ColorName, 'bg'],
      [s as ColorName, 'surface-1'],
      [s as ColorName, 'surface-3'],
      [s as ColorName, `${s}-soft` as ColorName],
    ]),
    ['accent', 'bg'],
    ['accent', 'surface'],
    ['info', 'surface'],
    ['success', 'surface'],
  ];

  it.each(['light', 'dark'] as const)('pasangan teks inti lulus 4.5:1 (%s)', (theme) => {
    for (const [fg, bg] of textPairs) {
      const ratio = contrastRatio(tokens.color[theme][fg], tokens.color[theme][bg]);
      expect(ratio, `${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('elemen UI non-teks lulus 3:1 (terang) dan 4.5:1 (gelap)', () => {
    for (const [fg, bg] of uiPairs) {
      const light = contrastRatio(tokens.color.light[fg], tokens.color.light[bg]);
      const dark = contrastRatio(tokens.color.dark[fg], tokens.color.dark[bg]);
      expect(light, `light ${fg}/${bg}`).toBeGreaterThanOrEqual(3);
      expect(dark, `dark ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /*
   * Pasangan yang GAGAL dengan nilai tabel DESIGN_SYSTEM.md. Daftar ini dikunci agar
   * perubahan token (perbaikan atau regresi) terlihat; lihat docs/BACKLOG.md.
   * `min` adalah ambang yang tidak tercapai (4.5 untuk teks, 3 untuk non-teks).
   */
  const KNOWN_FAILURES: { theme: 'light' | 'dark'; fg: ColorName; bg: ColorName; min: number }[] = [
    { theme: 'dark', fg: 'text', bg: 'accent', min: 4.5 },
  ];

  it.each(KNOWN_FAILURES)(
    'masih gagal (diketahui): $theme $fg di atas $bg',
    ({ theme, fg, bg, min }) => {
      expect(contrastRatio(tokens.color[theme][fg], tokens.color[theme][bg])).toBeLessThan(min);
    },
  );
});

describe('gamut sRGB', () => {
  it('semua warna di dalam gamut sRGB (palet Electric Slate diambil dari hex)', () => {
    const outside: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      for (const n of COLOR_NAMES) {
        if (!inSrgbGamut(tokens.color[theme][n])) outside.push(`${theme}.${n}`);
      }
    }
    expect(outside).toEqual([]);
  });
});

describe('file hasil generate', () => {
  it('tokens.css sama dengan hasil generator (jalankan pnpm --filter @aios/ui-tokens build)', () => {
    expect(read('tokens.css')).toBe(generateCss(tokens));
  });

  it('Tokens.kt sama dengan hasil generator', () => {
    expect(read('Tokens.kt')).toBe(generateKotlin(tokens));
  });

  it('tokens.css memuat tema sistem, tema manual, dan @theme Tailwind v4', () => {
    const css = generateCss(tokens);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain('@theme inline {');
    expect(css).toContain('--color-accent: var(--aios-accent);');
    expect(css).toContain("--font-sans: 'Geist', 'IBM Plex Sans', sans-serif;");
    expect(css).toContain("--font-mono: 'Geist Mono', 'IBM Plex Mono', monospace;");
    expect(css).toContain('--ease-standard: cubic-bezier(0.2, 0, 0, 1);');
    expect(css).toContain('--aios-accent: oklch(0.817 0.124 215.7);');
  });

  it('Tokens.kt memuat warna hex hasil konversi, dp, sp, dan easing', () => {
    const kt = generateKotlin(tokens);
    expect(kt).toContain('package app.aios.ui.tokens');
    expect(kt).toContain(`accent = Color(0xFF${toHex(tokens.color.light.accent)})`);
    expect(kt).toContain('val md = 12.dp');
    expect(kt).toContain('val chat = AiosTextStyle(16.sp, 25.6.sp, FontWeight.Normal)');
    expect(kt).toContain('CubicBezierEasing(0.2f, 0f, 0f, 1f)');
    expect(kt).toContain('val touchTarget = 48.dp');
  });

  it('CSS tidak memuat hex acak (hanya OKLCH)', () => {
    expect(generateCss(tokens)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('satu sumber: setiap warna token ada di CSS (OKLCH) dan di Kotlin (hex) untuk kedua tema', () => {
    const css = generateCss(tokens);
    const kt = generateKotlin(tokens);
    const camel = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    for (const theme of ['light', 'dark'] as const) {
      for (const n of COLOR_NAMES) {
        const value = tokens.color[theme][n];
        expect(css, `${theme} ${n}`).toContain(`--aios-${n}: ${value};`);
        const block = kt.slice(kt.indexOf(`val ${theme}Colors`), kt.indexOf('FontFamilyName'));
        expect(block, `${theme} ${n}`).toContain(`${camel(n)} = Color(0xFF${toHex(value)})`);
      }
    }
  });

  it('CSS dan Kotlin memuat radius, durasi, elevasi lapisan, dan pegas dari token yang sama', () => {
    const css = generateCss(tokens);
    const kt = generateKotlin(tokens);
    expect(css).toContain('--radius-*: initial;');
    for (const [name, px] of [
      ['sm', 8],
      ['md', 12],
      ['lg', 16],
      ['xl', 24],
    ] as const) {
      expect(css).toContain(`--radius-${name}: ${px}px;`);
      expect(kt).toContain(`val ${name} = ${px}.dp`);
    }
    for (const [name, ms] of [
      ['instant', 80],
      ['long', 420],
      ['extra', 640],
    ] as const) {
      expect(css).toContain(`--aios-duration-${name}: ${ms}ms;`);
      expect(kt).toContain(`const val ${name[0]!.toUpperCase()}${name.slice(1)}Ms = ${ms}`);
    }
    expect(css).toContain('--aios-loop-min: 1400ms;');
    for (const i of [1, 2, 3]) expect(css).toContain(`--aios-shadow-${i}:`);
    expect(css).toMatch(/--aios-easing-spring-move: linear\(0, /);
    expect(kt).toContain('const val SpringDampingRatio = 0.7f');
    expect(kt).toContain('const val SpringStiffness = 300f');
    expect(kt).toContain('val layer3 = 4.dp');
  });

  it('CSS meniadakan palet dan radius bawaan Tailwind supaya hanya token yang bisa dipakai', () => {
    const css = generateCss(tokens);
    expect(css).toContain('--color-*: initial;');
    expect(css).toContain('--radius-*: initial;');
  });
});

describe('pegas fisik', () => {
  const { dampingRatio, stiffness } = tokens.motion.springMove;
  const spring = springLinear(dampingRatio, stiffness);

  it('mulai di 0, berakhir tepat di 1, dan melewati 1 sekali dengan overshoot kecil', () => {
    expect(spring.points[0]).toBe(0);
    expect(spring.points.at(-1)).toBe(1);
    const peak = Math.max(...spring.points);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.1);
  });

  it('durasi wajar (200 sampai 600 ms) dan deterministik', () => {
    expect(spring.durationMs).toBeGreaterThanOrEqual(200);
    expect(spring.durationMs).toBeLessThanOrEqual(600);
    expect(springLinear(dampingRatio, stiffness)).toEqual(spring);
  });
});
