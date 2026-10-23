import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = {
  bash,
  css,
  ini,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition);

const BY_EXTENSION: Record<string, keyof typeof LANGUAGES> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
};

export function languageOf(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase();
  return extension ? BY_EXTENSION[extension] : undefined;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Satu baris diberi warna sintaks dan dikembalikan sebagai HTML yang sudah di-escape. Per baris, jadi komentar
 * atau string yang membentang beberapa baris tidak selalu terwarnai dengan benar; isi tetap tampil utuh.
 */
export function highlightLine(text: string, language: string | undefined): string {
  if (!language || text.length > 2000) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}
