/**
 * Pratinjau artifact (W16): blok kode HTML, SVG, satu komponen React, atau diagram Mermaid dibangun menjadi satu
 * halaman HTML utuh. Halaman ini tidak pernah dijalankan di dokumen aplikasi: desktop menyajikannya lewat custom
 * protocol Tauri `aiosartifact` (origin terpisah, iframe sandbox tanpa allow-same-origin), jadi skrip di dalamnya
 * tidak bisa menyentuh token, IPC, atau DOM aplikasi. React, Babel, dan Mermaid dimuat dari CDN dengan versi
 * terkunci dan hash SRI; CSP halaman dikirim oleh protocol itu (`src-tauri/src/artifact.rs`). Logika yang sama
 * ada di Android (`ArtifactPage.kt`); ubah keduanya bersamaan.
 */

export type ArtifactKind = 'html' | 'svg' | 'react' | 'mermaid';

/** Warna halaman dari token aplikasi (nilai CSS apa adanya, mis. oklch(...)). */
export interface ArtifactTheme {
  dark: boolean;
  bg: string;
  surface: string;
  text: string;
  text2: string;
  border: string;
  accent: string;
  danger: string;
}

interface CdnScript {
  src: string;
  integrity: string;
}

export const CDN = {
  react: {
    src: 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
    integrity: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
  },
  reactDom: {
    src: 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
    integrity: 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
  },
  babel: {
    src: 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js',
    integrity: 'sha384-x/ilTFv/u/eu6YSmkFDZl5V5Mm/pkxxcVv2cVJOrr1J0rvILhMvRBCy6yA75wYBj',
  },
  mermaid: {
    src: 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js',
    integrity: 'sha384-rbtjAdnIQE/aQJGEgXrVUlMibdfTSa4PQju4HDhN3sR2PmaKFzhEafuePsl9H/9I',
  },
} satisfies Record<string, CdnScript>;

const KINDS: Record<string, ArtifactKind> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  jsx: 'react',
  tsx: 'react',
  react: 'react',
  mermaid: 'mermaid',
  mmd: 'mermaid',
};

const REACT_COMPONENT = /export\s+default\b|\bfunction\s+App\b|\b(?:const|let)\s+App\b/;

/** Jenis artifact untuk blok kode ini, atau null bila tidak bisa dipratinjau. `language` boleh berupa path. */
export function artifactKind(language: string, code: string): ArtifactKind | null {
  const token = language.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const kind = KINDS[token.includes('.') ? (token.split('.').pop() ?? '') : token];
  if (!kind || !code.trim()) return null;
  if (kind === 'svg' && !/<svg[\s>]/i.test(code)) return null;
  // Potongan JSX tanpa komponen (mis. satu elemen) tidak bisa dirender sendiri.
  if (kind === 'react' && !REACT_COMPONENT.test(code)) return null;
  return kind;
}

/** Hasil menyiapkan kode React: sumber siap ditransformasi Babel dan nama komponen akar, atau pesan galat. */
export type PreparedReact = { source: string; component: string } | { error: string };

const REACT_IMPORT =
  /^\s*import\s+[\s\S]*?\s+from\s+['"]react(?:-dom(?:\/client)?)?['"];?[ \t]*$/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s+['"][^'"]+\.css['"];?[ \t]*$/gm;
const HOOKS = [
  'useState',
  'useEffect',
  'useLayoutEffect',
  'useRef',
  'useMemo',
  'useCallback',
  'useReducer',
  'useContext',
  'useId',
  'useTransition',
  'useDeferredValue',
  'createContext',
  'forwardRef',
  'memo',
  'Fragment',
];

/**
 * Mengubah satu berkas komponen React menjadi skrip mandiri: impor React dibuang (React tersedia global dan hook
 * di-destructure), `export default` diganti deklarasi biasa, lalu komponen akar dirender ke #root. Impor paket lain
 * tidak didukung dan dilaporkan sebagai galat yang jelas.
 */
export function prepareReact(code: string): PreparedReact {
  let source = code.replace(REACT_IMPORT, '').replace(SIDE_EFFECT_IMPORT, '');
  const other = /^\s*import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/m.exec(source);
  if (other)
    return { error: `Pratinjau hanya mendukung React; paket "${other[1]}" tidak tersedia.` };

  let component: string | null = null;
  const named = /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(source);
  if (named) {
    component = named[1]!;
    source = source.replace(/export\s+default\s+(?=(?:async\s+)?function\b)/, '');
  } else if (/export\s+default\s+(?:async\s+)?function\s*\(/.test(source)) {
    component = '__AiosApp';
    source = source.replace(/export\s+default\s+((?:async\s+)?function)\s*\(/, '$1 __AiosApp(');
  } else {
    const ident = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?[ \t]*$/m.exec(source);
    if (ident) {
      component = ident[1]!;
      source = source.replace(ident[0], '');
    } else if (/export\s+default\s+/.test(source)) {
      component = '__AiosApp';
      source = source.replace(/export\s+default\s+/, 'const __AiosApp = ');
    }
  }
  source = source.replace(
    /^(\s*)export\s+(?=(?:const|let|var|function|class|interface|type|enum|async)\b)/gm,
    '$1',
  );
  if (!component && /\b(?:function|const|let)\s+App\b/.test(source)) component = 'App';
  if (!component)
    return { error: 'Tidak ada komponen untuk dirender (butuh export default atau App).' };

  const prelude = `const { ${HOOKS.join(', ')} } = React;\n`;
  const mount = `\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(${component}));\n`;
  return { source: prelude + source + mount, component };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Nilai CSS dari token tidak boleh bisa menutup blok style. */
const cssValue = (value: string) => value.replace(/[<>{};]/g, '').trim();

/** Teks untuk disisipkan sebagai literal JS di dalam <script>: aman dari `</script>`. */
const jsString = (text: string) => JSON.stringify(text).replace(/</g, '\\u003c');

const scriptTag = ({ src, integrity }: CdnScript) =>
  `<script src="${src}" integrity="${integrity}" crossorigin="anonymous"></script>`;

function baseStyle(theme: ArtifactTheme): string {
  return [
    `:root { color-scheme: ${theme.dark ? 'dark' : 'light'}; }`,
    `html, body { margin: 0; min-height: 100%; background: ${cssValue(theme.bg)}; color: ${cssValue(theme.text)}; ` +
      'font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; }',
    `.aios-error { margin: 16px; padding: 12px; border: 1px solid ${cssValue(theme.danger)}; border-radius: 8px; ` +
      `color: ${cssValue(theme.danger)}; background: ${cssValue(theme.surface)}; white-space: pre-wrap; ` +
      'font: 13px/1.5 ui-monospace, Consolas, monospace; }',
  ].join('\n');
}

/** Galat skrip ditampilkan di halaman, bukan diam-diam kosong. */
const ERROR_HANDLER = `<script>
function aiosShowError(message) {
  var box = document.createElement('pre');
  box.className = 'aios-error';
  box.textContent = String(message);
  document.body.appendChild(box);
}
window.addEventListener('error', function (event) { aiosShowError(event.message || 'Galat saat menjalankan pratinjau.'); });
</script>`;

function page(theme: ArtifactTheme, head: string, body: string): string {
  return (
    '<!doctype html>\n<html lang="id">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<style>\n${baseStyle(theme)}\n</style>\n${ERROR_HANDLER}\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`
  );
}

/** Potongan HTML tidak menempel ke tepi bingkai. */
const FRAGMENT_STYLE = '<style>body { padding: 16px; box-sizing: border-box; }</style>';

/** Halaman HTML lengkap untuk satu artifact. */
export function buildArtifactPage(kind: ArtifactKind, code: string, theme: ArtifactTheme): string {
  switch (kind) {
    case 'html':
      // Dokumen utuh dipakai apa adanya; potongan dibungkus agar mendapat warna tema.
      return /<!doctype|<html[\s>]/i.test(code) ? code : page(theme, FRAGMENT_STYLE, code);
    case 'svg':
      return page(
        theme,
        '<style>body { display: grid; place-items: center; padding: 16px; box-sizing: border-box; } svg { max-width: 100%; height: auto; }</style>',
        code,
      );
    case 'mermaid':
      return page(
        theme,
        `<style>body { padding: 16px; } .mermaid { display: flex; justify-content: center; }</style>\n${scriptTag(CDN.mermaid)}`,
        `<pre class="mermaid">${escapeHtml(code)}</pre>\n<script>
if (!window.mermaid) { aiosShowError('Mermaid gagal dimuat. Periksa koneksi internet.'); }
else {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: ${jsString(theme.dark ? 'dark' : 'default')} });
  mermaid.run().catch(function (error) { aiosShowError(error && error.message ? error.message : error); });
}
</script>`,
      );
    case 'react': {
      const prepared = prepareReact(code);
      if ('error' in prepared)
        return page(theme, '', `<pre class="aios-error">${escapeHtml(prepared.error)}</pre>`);
      return page(
        theme,
        [scriptTag(CDN.react), scriptTag(CDN.reactDom), scriptTag(CDN.babel)].join('\n'),
        `<div id="root"></div>\n<script>
(function () {
  if (!window.React || !window.ReactDOM || !window.Babel) { aiosShowError('React gagal dimuat. Periksa koneksi internet.'); return; }
  try {
    var output = Babel.transform(${jsString(prepared.source)}, {
      filename: 'App.tsx',
      presets: [['typescript', { isTSX: true, allExtensions: true }], 'react'],
    }).code;
    var script = document.createElement('script');
    script.textContent = output;
    document.body.appendChild(script);
  } catch (error) {
    aiosShowError(error && error.message ? error.message : error);
  }
})();
</script>`,
      );
    }
  }
}
