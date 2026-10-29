import { COLOR_NAMES, TYPE_ROLES, type Tokens } from './tokens.js';

export const GENERATED_NOTICE =
  'GENERATED oleh packages/ui-tokens dari tokens.json. Jangan diedit tangan; jalankan pnpm --filter @aios/ui-tokens build.';

const px = (n: number) => `${n}px`;
const ms = (n: number) => `${n}ms`;
const indent = (lines: string[], by: string) => lines.map((l) => `${by}${l}`).join('\n');

/**
 * Kurva `linear()` dari respons langkah pegas redaman-kurang (massa 1, seperti `spring()` Compose).
 * Titik dicuplik seragam sampai amplitudo sisa < 0,1% (durasi = waktu itu); titik terakhir tepat 1.
 */
export function springLinear(
  dampingRatio: number,
  stiffness: number,
  samples = 24,
): { points: number[]; durationMs: number } {
  const omega = Math.sqrt(stiffness);
  const decay = dampingRatio * omega;
  const damped = omega * Math.sqrt(1 - dampingRatio ** 2);
  const seconds = Math.log(1000) / decay;
  const step = (t: number) =>
    1 - Math.exp(-decay * t) * (Math.cos(damped * t) + (decay / damped) * Math.sin(damped * t));
  const round = (n: number) => Number(n.toFixed(4));
  const points = Array.from({ length: samples + 1 }, (_, i) =>
    i === 0 ? 0 : i === samples ? 1 : round(step((seconds * i) / samples)),
  );
  return { points, durationMs: Math.round(seconds * 1000) };
}

function themeDeclarations(tokens: Tokens, theme: 'light' | 'dark'): string[] {
  return [
    `color-scheme: ${theme};`,
    ...COLOR_NAMES.map((n) => `--aios-${n}: ${tokens.color[theme][n]};`),
    `--aios-shadow-float: ${tokens.shadow.float[theme]};`,
    ...tokens.shadow.layers.map((s, i) => `--aios-shadow-${i + 1}: ${s[theme]};`),
  ];
}

function themeInlineDeclarations(tokens: Tokens): string[] {
  const d = tokens.type;
  const f = tokens.font.family;
  const lines: string[] = [
    // Palet dan radius bawaan Tailwind dimatikan: hanya token yang punya utilitas.
    '--color-*: initial;',
    ...COLOR_NAMES.map((n) => `--color-${n}: var(--aios-${n});`),
    `--font-sans: '${f.sans}', '${f.fallback.sans}', sans-serif;`,
    `--font-mono: '${f.mono}', '${f.fallback.mono}', monospace;`,
  ];
  for (const role of TYPE_ROLES) {
    const spec = d[role].desktop;
    lines.push(`--text-${role}: ${px(spec.size)};`);
    lines.push(`--text-${role}--line-height: ${spec.lineHeight};`);
    lines.push(`--text-${role}--font-weight: ${spec.weight};`);
  }
  lines.push('--spacing: 4px;');
  const r = tokens.radius.desktop;
  lines.push(
    '--radius-*: initial;',
    `--radius-sm: ${px(r.sm)};`,
    `--radius-md: ${px(r.md)};`,
    `--radius-lg: ${px(r.lg)};`,
    `--radius-xl: ${px(r.xl)};`,
    // Nama peran yang dipakai komponen: badge/chip, kontrol (tombol, input), panel/kartu, sheet/dialog.
    `--radius-badge: ${px(r.sm)};`,
    `--radius-control: ${px(r.md)};`,
    `--radius-panel: ${px(r.lg)};`,
    `--radius-sheet: ${px(r.xl)};`,
  );
  lines.push('--shadow-float: var(--aios-shadow-float);');
  for (const i of [1, 2, 3]) lines.push(`--shadow-layer-${i}: var(--aios-shadow-${i});`);
  lines.push(`--ease-standard: cubic-bezier(${tokens.motion.easing.join(', ')});`);
  lines.push('--ease-spring-move: var(--aios-easing-spring-move);');
  return lines;
}

function plainDeclarations(tokens: Tokens): string[] {
  const { duration, easing, spring, springMove, loopMinMs } = tokens.motion;
  const move = springLinear(springMove.dampingRatio, springMove.stiffness);
  const l = tokens.layout.desktop;
  return [
    ...tokens.space.map((s) => `--aios-space-${s}: ${px(s)};`),
    `--aios-radius-full: 9999px;`,
    `--aios-duration-instant: ${ms(duration.instant)};`,
    `--aios-duration-fast: ${ms(duration.fast)};`,
    `--aios-duration-base: ${ms(duration.base)};`,
    `--aios-duration-slow: ${ms(duration.slow)};`,
    `--aios-duration-emphasis: ${ms(duration.emphasis)};`,
    `--aios-duration-long: ${ms(duration.long)};`,
    `--aios-duration-extra: ${ms(duration.extra)};`,
    `--aios-loop-min: ${ms(loopMinMs)};`,
    `--aios-easing: cubic-bezier(${easing.join(', ')});`,
    `--aios-easing-spring: cubic-bezier(${spring.join(', ')});`,
    `--aios-easing-spring-move: linear(${move.points.join(', ')});`,
    `--aios-duration-spring-move: ${ms(move.durationMs)};`,
    `--aios-focus-width: ${px(tokens.focus.width)};`,
    `--aios-focus-offset: ${px(tokens.focus.offset)};`,
    `--aios-sidebar-width: ${px(l.sidebar)};`,
    `--aios-sidebar-compact-width: ${px(l.sidebarCompact)};`,
    `--aios-topbar-height: ${px(l.topbar)};`,
    `--aios-statusbar-height: ${px(l.statusBar)};`,
    `--aios-row-height: ${px(l.row)};`,
    `--aios-island-gap: ${px(l.islandGap)};`,
    `--aios-page-measure: ${px(l.pageMeasure)};`,
    `--aios-chat-measure: ${tokens.layout.chatMeasureCh}ch;`,
  ];
}

/**
 * Tema mengikuti sistem secara default; atribut data-theme="light|dark" di <html>
 * memaksa pilihan manual (DESIGN_SYSTEM.md). @theme inline membuat utilitas Tailwind
 * membaca variabel saat runtime sehingga berganti tema tanpa build ulang.
 */
export function generateCss(tokens: Tokens): string {
  return [
    `/* ${GENERATED_NOTICE} */`,
    '',
    ':root {',
    indent([...themeDeclarations(tokens, 'light'), ...plainDeclarations(tokens)], '  '),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    "  :root:not([data-theme='light']) {",
    indent(themeDeclarations(tokens, 'dark'), '    '),
    '  }',
    '}',
    '',
    ":root[data-theme='dark'] {",
    indent(themeDeclarations(tokens, 'dark'), '  '),
    '}',
    '',
    '@theme inline {',
    indent(themeInlineDeclarations(tokens), '  '),
    '}',
    '',
  ].join('\n');
}
