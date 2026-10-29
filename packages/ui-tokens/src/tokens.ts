import { readFileSync } from 'node:fs';
import { z } from 'zod';

const OKLCH = /^oklch\(\s*(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s*\)$/;
const OklchSchema = z.string().regex(OKLCH, 'harus oklch(L C H) tanpa alfa');

/** Warna status do agent: berpikir (violet), tool (amber), menulis (cyan), selesai (emerald), galat (merah). */
export const STATUS_NAMES = ['thinking', 'tool', 'writing', 'done', 'error'] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

export const COLOR_NAMES = [
  'bg',
  'surface',
  'surface-1',
  'surface-2',
  'surface-3',
  'border',
  'border-strong',
  'text',
  'text-2',
  'text-3',
  'accent',
  'accent-soft',
  'success',
  'warning',
  'danger',
  'info',
  // Tiap status: solid, soft (latar), on (teks di atas solid).
  ...STATUS_NAMES.flatMap((s) => [s, `${s}-soft`, `${s}-on`] as const),
] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

const ColorSetSchema = z.object(
  Object.fromEntries(COLOR_NAMES.map((n) => [n, OklchSchema])) as Record<
    ColorName,
    typeof OklchSchema
  >,
);

export const TYPE_ROLES = ['caption', 'meta', 'ui', 'chat', 'section', 'page'] as const;
export type TypeRole = (typeof TYPE_ROLES)[number];

const TypeSpecSchema = z.object({
  size: z.number().positive(),
  lineHeight: z.number().positive(),
  weight: z.union([z.literal(400), z.literal(500), z.literal(600)]),
});
const TypeRoleSchema = z.object({ desktop: TypeSpecSchema, android: TypeSpecSchema });

const RadiusSchema = z.object({
  sm: z.number().positive(),
  md: z.number().positive(),
  lg: z.number().positive(),
  xl: z.number().positive(),
});

const ThemedShadowSchema = z.object({ light: z.string().min(1), dark: z.string().min(1) });

export const TokensSchema = z.object({
  color: z.object({ light: ColorSetSchema, dark: ColorSetSchema }),
  font: z.object({
    family: z.object({
      sans: z.string().min(1),
      mono: z.string().min(1),
      /** Dipakai bila font utama gagal dimuat. */
      fallback: z.object({ sans: z.string().min(1), mono: z.string().min(1) }),
    }),
    weights: z.array(z.number().int()),
  }),
  type: z.object(
    Object.fromEntries(TYPE_ROLES.map((r) => [r, TypeRoleSchema])) as Record<
      TypeRole,
      typeof TypeRoleSchema
    >,
  ),
  space: z.array(z.number().int().positive()).refine((s) => s.every((v) => v % 4 === 0), {
    message: 'spasi harus kelipatan 4',
  }),
  radius: z.object({ desktop: RadiusSchema, android: RadiusSchema }),
  shadow: z.object({
    float: ThemedShadowSchema,
    /** Bayangan tipis untuk surface-1, surface-2, surface-3 (makin tinggi makin tegas). */
    layers: z.tuple([ThemedShadowSchema, ThemedShadowSchema, ThemedShadowSchema]),
    androidElevation: z.number().positive(),
    androidLayers: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  }),
  motion: z.object({
    duration: z.object({
      /** Tekan dan umpan balik sangat singkat. */
      instant: z.number().int().positive(),
      fast: z.number().int().positive(),
      base: z.number().int().positive(),
      slow: z.number().int().positive(),
      /** Animasi masuk yang menonjol (layar sambutan, pesan baru). */
      emphasis: z.number().int().positive(),
      /** Transisi layar dan perpindahan besar. */
      long: z.number().int().positive(),
      /** Urutan sinematik yang jarang (sambutan, selesai besar). */
      extra: z.number().int().positive(),
    }),
    easing: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    /** Pegas ringan: sedikit melewati target lalu kembali (bukan pantulan berulang). */
    spring: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    /** Pegas fisik untuk elemen yang berpindah posisi (daftar, kartu, panel). */
    springMove: z.object({
      dampingRatio: z.number().positive().lt(1),
      stiffness: z.number().positive(),
    }),
    /** Siklus minimum animasi tak berhingga (kilau, denyut), dalam ms. */
    loopMinMs: z.number().int().positive(),
  }),
  focus: z.object({ width: z.number().positive(), offset: z.number().nonnegative() }),
  layout: z.object({
    desktop: z.object({
      sidebar: z.number().positive(),
      sidebarCompact: z.number().positive(),
      topbar: z.number().positive(),
      statusBar: z.number().positive(),
      row: z.number().positive(),
      /** Jarak antar pulau (panel melayang) di shell. */
      islandGap: z.number().positive(),
      /** Lebar isi halaman yang sama untuk semua layar non-chat (PageContainer). */
      pageMeasure: z.number().positive(),
    }),
    android: z.object({ touchTarget: z.number().positive() }),
    chatMeasureCh: z.number().int().positive(),
  }),
});
export type Tokens = z.infer<typeof TokensSchema>;

export function parseOklch(value: string): { l: number; c: number; h: number } {
  const m = OKLCH.exec(value);
  if (!m) throw new Error(`bukan oklch(): ${value}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

/** Membaca dan memvalidasi tokens.json di akar paket. */
export function loadTokens(): Tokens {
  const raw: unknown = JSON.parse(readFileSync(new URL('../tokens.json', import.meta.url), 'utf8'));
  return TokensSchema.parse(raw);
}
