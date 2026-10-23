import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

export interface ExtractedPage {
  title: string;
  /** Teks bersih tanpa markup, paragraf dipisah baris kosong. */
  text: string;
  byline: string | null;
  /** Tanggal terbit bila halaman menyebutkannya (ISO 8601 atau apa adanya). */
  publishedAt: string | null;
}

/** Di bawah ini halaman dianggap kosong atau belum dirender. */
export const MIN_TEXT_CHARS = 400;
export const MAX_TEXT_CHARS = 12_000;

const clean = (text: string): string =>
  text
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Nilai pertama yang tidak kosong (string kosong dianggap tidak ada, berbeda dari null). */
const firstText = (...values: (string | null | undefined)[]): string | null =>
  values.map((v) => v?.trim()).find((v): v is string => !!v) ?? null;

/**
 * Ekstraksi teks bersih dengan Readability. jsdom dipakai tanpa menjalankan skrip dan tanpa memuat
 * sumber daya luar (perilaku bawaan), jadi halaman tidak bisa memicu permintaan keluar dari sini.
 */
export function extractReadable(html: string, url: string): ExtractedPage {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const { document } = dom.window;
    const meta = (selector: string) => document.querySelector(selector)?.getAttribute('content');
    const publishedAt = firstText(
      meta('meta[property="article:published_time"]'),
      meta('meta[name="date"]'),
      meta('meta[itemprop="datePublished"]'),
      document.querySelector('time[datetime]')?.getAttribute('datetime'),
    );
    const fallbackTitle = document.title.trim();

    // Readability memodifikasi dokumen, jadi baca meta di atas lebih dulu.
    const article = new Readability(document).parse();
    const text = clean(article?.textContent ?? document.body?.textContent ?? '');
    return {
      title: (firstText(article?.title, fallbackTitle) ?? url).slice(0, 300),
      text: text.slice(0, MAX_TEXT_CHARS),
      byline: firstText(article?.byline),
      publishedAt: firstText(article?.publishedTime) ?? publishedAt,
    };
  } finally {
    dom.window.close();
  }
}

/**
 * Halaman yang teksnya hampir kosong tetapi penuh skrip biasanya aplikasi satu halaman
 * yang baru terisi setelah JavaScript berjalan.
 */
export function needsJavaScript(html: string, textLength: number): boolean {
  if (textLength >= MIN_TEXT_CHARS) return false;
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  return scripts >= 2 || /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html);
}
