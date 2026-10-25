import { describe, expect, it } from 'vitest';
import { type ArtifactTheme, artifactKind, buildArtifactPage, CDN, prepareReact } from './artifact';

const theme: ArtifactTheme = {
  dark: true,
  bg: 'oklch(0.2 0.03 260)',
  surface: 'oklch(0.25 0.03 260)',
  text: 'oklch(0.95 0 0)',
  text2: 'oklch(0.8 0 0)',
  border: 'oklch(0.4 0 0)',
  accent: 'oklch(0.8 0.1 210)',
  danger: 'oklch(0.7 0.2 25)',
};

describe('artifactKind', () => {
  it('mengenali bahasa dan ekstensi path', () => {
    expect(artifactKind('html', '<p>x</p>')).toBe('html');
    expect(artifactKind('index.html', '<p>x</p>')).toBe('html');
    expect(artifactKind('src/App.jsx', 'export default function App() {}')).toBe('react');
    expect(artifactKind('mermaid', 'graph TD; A-->B')).toBe('mermaid');
    expect(artifactKind('svg', '<svg viewBox="0 0 1 1"></svg>')).toBe('svg');
  });

  it('menolak blok yang tidak bisa berdiri sendiri', () => {
    expect(artifactKind('js', 'console.log(1)')).toBeNull();
    expect(artifactKind('jsx', '<div>hanya elemen</div>')).toBeNull();
    expect(artifactKind('svg', 'bukan svg')).toBeNull();
    expect(artifactKind('html', '   ')).toBeNull();
    expect(artifactKind('', '<p>x</p>')).toBeNull();
  });
});

describe('prepareReact', () => {
  it('membuang impor React, mengganti export default fungsi bernama, dan me-mount komponen', () => {
    const out = prepareReact(
      "import React, { useState } from 'react';\nimport './App.css';\n\nexport default function Todo() {\n  const [n] = useState(0);\n  return <p>{n}</p>;\n}\n",
    );
    expect(out).toMatchObject({ component: 'Todo' });
    if ('error' in out) throw new Error(out.error);
    expect(out.source).not.toMatch(/import/);
    expect(out.source).not.toMatch(/export/);
    expect(out.source).toMatch(/^const \{ useState,/);
    expect(out.source).toMatch(/function Todo\(\)/);
    expect(out.source).toMatch(/render\(React\.createElement\(Todo\)\)/);
  });

  it('impor multi-baris dari react ikut dibuang', () => {
    const out = prepareReact(
      "import {\n  useState,\n  useEffect,\n} from 'react';\nexport default function App() { return null; }",
    );
    expect('error' in out ? out.error : out.source).not.toMatch(/import/);
  });

  it('export default identifier, fungsi anonim, dan ekspresi panah', () => {
    expect(prepareReact('const Card = () => <b/>;\nexport default Card;')).toMatchObject({
      component: 'Card',
    });
    expect(prepareReact('export default function () { return <i/>; }')).toMatchObject({
      component: '__AiosApp',
    });
    const arrow = prepareReact('export default () => <u/>;');
    expect(arrow).toMatchObject({ component: '__AiosApp' });
    expect('source' in arrow && arrow.source).toMatch(/const __AiosApp = \(\) =>/);
  });

  it('tanpa export default: memakai App; export bernama dilepas', () => {
    const out = prepareReact('export const COLORS = [];\nfunction App() { return null; }');
    expect(out).toMatchObject({ component: 'App' });
    expect('source' in out && out.source).toMatch(/^const COLORS/m);
  });

  it('paket selain React dan berkas tanpa komponen: galat yang jelas', () => {
    const errorOf = (code: string) => {
      const out = prepareReact(code);
      return 'error' in out ? out.error : null;
    };
    expect(errorOf("import { Bell } from 'lucide-react';\nexport default function A() {}")).toMatch(
      /lucide-react/,
    );
    expect(errorOf('const x = 1;')).toMatch(/komponen/);
  });
});

describe('buildArtifactPage', () => {
  it('potongan HTML dibungkus dengan warna token; dokumen utuh dipakai apa adanya', () => {
    const page = buildArtifactPage('html', '<h1>Halo</h1>', theme);
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain('<h1>Halo</h1>');
    expect(page).toContain('background: oklch(0.2 0.03 260)');
    expect(page).toContain('color-scheme: dark');
    const full = '<!DOCTYPE html><html><body>x</body></html>';
    expect(buildArtifactPage('html', full, theme)).toBe(full);
  });

  it('nilai tema tidak bisa keluar dari blok style', () => {
    const page = buildArtifactPage('svg', '<svg></svg>', {
      ...theme,
      bg: 'red;}</style><script>x()</script>',
    });
    expect(page).not.toContain('</style><script>x()');
  });

  it('Mermaid: kode di-escape, skrip CDN terkunci dengan SRI, securityLevel strict', () => {
    const page = buildArtifactPage('mermaid', 'graph TD\n  A["<b>x</b>"] --> B', theme);
    expect(page).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(page).toContain(`src="${CDN.mermaid.src}" integrity="${CDN.mermaid.integrity}"`);
    expect(page).toContain("securityLevel: 'strict'");
    expect(page).toContain('theme: "dark"');
  });

  it('React: sumber disisipkan sebagai literal JS yang tidak bisa menutup <script>', () => {
    const page = buildArtifactPage(
      'react',
      'export default function App() { return <p>{"</script><script>alert(1)</script>"}</p>; }',
      theme,
    );
    expect(page).toContain(CDN.react.integrity);
    expect(page).toContain(CDN.babel.integrity);
    expect(page.match(/<\/script>/g)?.length).toBe(page.match(/<script/g)?.length);
    expect(page).not.toContain('alert(1)</script>');
  });

  it('React dengan impor yang tidak didukung: halaman berisi pesan galat', () => {
    const page = buildArtifactPage(
      'react',
      "import x from 'lodash';\nexport default function A() {}",
      theme,
    );
    expect(page).toContain('class="aios-error"');
    expect(page).toContain('lodash');
    expect(page).not.toContain(CDN.babel.src);
  });
});
