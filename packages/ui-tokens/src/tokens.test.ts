import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, inSrgbGamut, oklchToSrgb8, toHex } from './color.js';
import { generateCss } from './css.js';
import { generateKotlin } from './kotlin.js';
import { COLOR_NAMES, TokensSchema, loadTokens, type ColorName } from './tokens.js';

const tokens = loadTokens();
const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('tokens.json', () => {
  it('memuat 14 warna di tema terang dan gelap', () => {
    expect(COLOR_NAMES).toHaveLength(14);
    expect(Object.keys(tokens.color.light).sort()).toEqual([...COLOR_NAMES].sort());
    expect(Object.keys(tokens.color.dark).sort()).toEqual([...COLOR_NAMES].sort());
  });

  it('spasi kelipatan 4 sesuai DESIGN_SYSTEM.md', () => {
    expect(tokens.space).toEqual([4, 8, 12, 16, 20, 24, 32, 40, 48]);
  });

  it('radius desktop 4/6/10 dan Android 8/12/16; gerak 120/180/240 ms', () => {
    expect(tokens.radius.desktop).toEqual({ sm: 4, md: 6, lg: 10 });
    expect(tokens.radius.android).toEqual({ sm: 8, md: 12, lg: 16 });
    expect(tokens.motion.duration).toEqual({ fast: 120, base: 180, slow: 240 });
    expect(tokens.motion.easing).toEqual([0.2, 0, 0, 1]);
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
    ['text', 'bg'],
    ['text', 'surface'],
    ['text', 'surface-2'],
    ['text-2', 'bg'],
    ['text-2', 'surface'],
    ['text-2', 'surface-2'],
    ['text', 'accent-soft'],
    ['danger', 'surface'],
  ];
  const uiPairs: Pair[] = [
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
    { theme: 'light', fg: 'text-3', bg: 'surface', min: 4.5 },
    { theme: 'light', fg: 'text-3', bg: 'bg', min: 4.5 },
    { theme: 'dark', fg: 'text-3', bg: 'surface', min: 4.5 },
    { theme: 'light', fg: 'warning', bg: 'surface', min: 3 },
    { theme: 'light', fg: 'surface', bg: 'accent', min: 4.5 },
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
  it('semua warna di dalam gamut kecuali accent-soft terang (dipotong ke sRGB)', () => {
    const outside: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      for (const n of COLOR_NAMES) {
        if (!inSrgbGamut(tokens.color[theme][n])) outside.push(`${theme}.${n}`);
      }
    }
    expect(outside).toEqual(['light.accent-soft']);
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
    expect(css).toContain("--font-sans: 'IBM Plex Sans', sans-serif;");
    expect(css).toContain('--ease-standard: cubic-bezier(0.2, 0, 0, 1);');
    expect(css).toContain('--aios-accent: oklch(0.72 0.15 50);');
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
});
