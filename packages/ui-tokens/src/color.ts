import { parseOklch } from './tokens.js';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

/** OKLCH ke sRGB linear (belum di-clamp). Matriks dari Björn Ottosson. */
export function oklchToLinearSrgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m_ = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s_ = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);
  return {
    r: 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    g: -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    b: -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  };
}

/** True bila warna berada di dalam gamut sRGB (toleransi kecil untuk galat pembulatan). */
export function inSrgbGamut(oklch: string, eps = 0.002): boolean {
  const { l, c, h } = parseOklch(oklch);
  const { r, g, b } = oklchToLinearSrgb(l, c, h);
  return [r, g, b].every((v) => v >= -eps && v <= 1 + eps);
}

/** OKLCH ke sRGB 8-bit; di luar gamut dipotong per kanal. */
export function oklchToSrgb8(oklch: string): [number, number, number] {
  const { l, c, h } = parseOklch(oklch);
  const lin = oklchToLinearSrgb(l, c, h);
  const to8 = (v: number) => Math.round(encode(clamp01(v)) * 255);
  return [to8(lin.r), to8(lin.g), to8(lin.b)];
}

export function toHex(oklch: string): string {
  return oklchToSrgb8(oklch)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function luminance(oklch: string): number {
  const { l, c, h } = parseOklch(oklch);
  const { r, g, b } = oklchToLinearSrgb(l, c, h);
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

/** Rasio kontras WCAG 2.x antara dua warna OKLCH. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
