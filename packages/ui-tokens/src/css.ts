import { COLOR_NAMES, TYPE_ROLES, type Tokens } from './tokens.js';

export const GENERATED_NOTICE =
  'GENERATED oleh packages/ui-tokens dari tokens.json. Jangan diedit tangan; jalankan pnpm --filter @aios/ui-tokens build.';

const px = (n: number) => `${n}px`;
const ms = (n: number) => `${n}ms`;
const indent = (lines: string[], by: string) => lines.map((l) => `${by}${l}`).join('\n');

function themeDeclarations(tokens: Tokens, theme: 'light' | 'dark'): string[] {
  return [
    `color-scheme: ${theme};`,
    ...COLOR_NAMES.map((n) => `--aios-${n}: ${tokens.color[theme][n]};`),
    `--aios-shadow-float: ${tokens.shadow.float[theme]};`,
  ];
}

function themeInlineDeclarations(tokens: Tokens): string[] {
  const d = tokens.type;
  const lines: string[] = [
    ...COLOR_NAMES.map((n) => `--color-${n}: var(--aios-${n});`),
    `--font-sans: '${tokens.font.family.sans}', sans-serif;`,
    `--font-mono: '${tokens.font.family.mono}', monospace;`,
  ];
  for (const role of TYPE_ROLES) {
    const spec = d[role].desktop;
    lines.push(`--text-${role}: ${px(spec.size)};`);
    lines.push(`--text-${role}--line-height: ${spec.lineHeight};`);
    lines.push(`--text-${role}--font-weight: ${spec.weight};`);
  }
  lines.push('--spacing: 4px;');
  const r = tokens.radius.desktop;
  lines.push(`--radius-sm: ${px(r.sm)};`, `--radius-md: ${px(r.md)};`, `--radius-lg: ${px(r.lg)};`);
  lines.push('--shadow-float: var(--aios-shadow-float);');
  lines.push(`--ease-standard: cubic-bezier(${tokens.motion.easing.join(', ')});`);
  return lines;
}

function plainDeclarations(tokens: Tokens): string[] {
  const { duration, easing } = tokens.motion;
  const l = tokens.layout.desktop;
  return [
    ...tokens.space.map((s) => `--aios-space-${s}: ${px(s)};`),
    `--aios-radius-full: 9999px;`,
    `--aios-duration-fast: ${ms(duration.fast)};`,
    `--aios-duration-base: ${ms(duration.base)};`,
    `--aios-duration-slow: ${ms(duration.slow)};`,
    `--aios-easing: cubic-bezier(${easing.join(', ')});`,
    `--aios-focus-width: ${px(tokens.focus.width)};`,
    `--aios-focus-offset: ${px(tokens.focus.offset)};`,
    `--aios-rail-width: ${px(l.rail)};`,
    `--aios-sidebar-width: ${px(l.sidebar)};`,
    `--aios-statusbar-height: ${px(l.statusBar)};`,
    `--aios-row-height: ${px(l.row)};`,
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
