import { readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('tanpa gradien, glassmorphism, blur dekoratif, dan animasi pantul', () => {
    expect(
      hits(
        /\b(?:bg-gradient|bg-linear|bg-radial|from-|via-|backdrop-blur|blur-|animate-bounce|animate-ping)/,
        /\.tsx$/,
      ),
    ).toEqual([]);
    expect(hits(/linear-gradient|radial-gradient|backdrop-filter/, /\.(tsx|css)$/)).toEqual([]);
  });

  it('tanpa emoji di UI (ikon hanya Lucide)', () => {
    expect(
      hits(/\p{Extended_Pictographic}/u, /\.tsx?$/).filter((l) => !l.includes('copy.ts')),
    ).toEqual([]);
  });

  it('ukuran teks hanya dari skala (caption, meta, ui, chat, section, page); tanpa text-[Npx] atau text-lg', () => {
    expect(hits(/\btext-(?:\[\d|xs\b|sm\b|base\b|lg\b|xl\b|\dxl\b)/, /\.tsx$/)).toEqual([]);
  });

  it('radius hanya dari token (badge, control, panel) atau bulat penuh; tanpa rounded-xl/2xl/3xl', () => {
    expect(hits(/\brounded(?:-(?:sm|md|lg|xl|2xl|3xl))\b|\brounded-\[/, /\.tsx$/)).toEqual([]);
  });

  it('bayangan hanya token shadow-float (menu, popover, dialog, toast)', () => {
    const bad = hits(/\bshadow-(?!float\b)[a-z0-9]+/, /\.tsx$/).concat(
      hits(/\bshadow(?![-\w])/, /\.tsx$/),
    );
    expect(bad).toEqual([]);
  });

  it('durasi transisi hanya 120/180/240 ms dengan kurva token (ease-aios)', () => {
    const durations = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/duration-\[(\d+)ms\]/g)].map((m) => ({ file, ms: Number(m[1]) })),
    );
    expect(durations.length).toBeGreaterThan(0);
    expect(durations.filter((d) => ![120, 180, 240].includes(d.ms))).toEqual([]);
    expect(hits(/\bduration-(?:\d+)\b|\bease-(?:in|out|in-out|linear)\b/, /\.tsx$/)).toEqual([]);
  });

  it('font hanya IBM Plex (tanpa font-serif atau font family lain di komponen)', () => {
    expect(hits(/\bfont-serif\b|font-family:/, /\.tsx$/)).toEqual([]);
  });

  it('tombol ikon punya nama untuk pembaca layar: IconButton selalu mewajibkan label', () => {
    const iconButton = sources.find((s) => s.file === 'ui/IconButton.tsx')?.text ?? '';
    expect(iconButton).toMatch(/label: string/);
    expect(iconButton).toMatch(/aria-label=\{label\}/);
  });
});
