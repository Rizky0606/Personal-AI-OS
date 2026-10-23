import PDFDocument from 'pdfkit';
import { parseBlocks, type Inline } from './markdown.js';

/** Huruf yang ada di font bawaan PDF (Helvetica, WinAnsi): Latin-1 ditambah tanda baca umum. */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const toWinAnsi = (text: string): string =>
  [...text]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0xa0 || code === 0x2011) return ' ';
      return code <= 0xff || WIN_ANSI_EXTRA.includes(ch) ? ch : '?';
    })
    .join('');

const MARGIN = 56;
const COLOR_TEXT = '#1a1a1a';
const COLOR_LINK = '#1a4fa0';
const HEADING_SIZE = { 1: 20, 2: 15, 3: 12.5 } as const;

function fontFor(inline: Inline, baseBold: boolean): string {
  const bold = inline.bold === true || baseBold;
  if (bold && inline.italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (inline.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/**
 * Laporan Markdown menjadi PDF A4 dengan font bawaan (tanpa browser). Tautan sumber bisa diklik.
 * Karakter di luar WinAnsi (mis. CJK, emoji) diganti "?".
 */
export function renderReportPdf(markdown: string, info: { title: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: { Title: toWinAnsi(info.title).slice(0, 200), Producer: 'Personal AI OS' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const writeInlines = (
      inlines: Inline[],
      options: { size: number; bold?: boolean; indent?: number; gap?: number },
    ) => {
      inlines.forEach((inline, index) => {
        const last = index === inlines.length - 1;
        doc
          .font(fontFor(inline, options.bold ?? false))
          .fontSize(options.size)
          .fillColor(inline.link ? COLOR_LINK : COLOR_TEXT)
          .text(toWinAnsi(inline.text), {
            continued: !last,
            lineGap: 2,
            ...(inline.link ? { link: inline.link, underline: true } : { underline: false }),
          });
      });
      if (inlines.length === 0) doc.text('');
      doc.moveDown(options.gap ?? 0.6);
    };

    for (const block of parseBlocks(markdown)) {
      if (block.type === 'heading') {
        if (block.level > 1) doc.moveDown(0.4);
        writeInlines(block.inlines, { size: HEADING_SIZE[block.level], bold: true, gap: 0.5 });
      } else if (block.type === 'paragraph') {
        writeInlines(block.inlines, { size: 10.5 });
      } else {
        block.items.forEach((item, i) => {
          const marker: Inline = { text: block.ordered ? `${i + 1}. ` : '•  ' };
          writeInlines([marker, ...item], { size: 10.5, gap: 0.3 });
        });
        doc.moveDown(0.3);
      }
    }
    doc.end();
  });
}
