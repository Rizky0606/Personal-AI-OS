import { useMemo } from 'react';
import { copy } from '../copy';
import { richAnswerFallbackData, type RichFallbackSection } from './richAnswerParser';

function FallbackTable({
  title,
  columns,
  rows,
}: {
  title?: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-ui">
        {title ? <caption className="pb-1 text-left text-meta text-text-2">{title}</caption> : null}
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th
                key={i}
                scope="col"
                className="border-b border-border-strong px-2 py-1 text-left font-semibold"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="border-b border-border px-2 py-1 align-top break-words">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FallbackSection({ section }: { section: RichFallbackSection }) {
  const f = copy.richFallback;
  switch (section.kind) {
    case 'pairs':
      return (
        <FallbackTable
          title={section.title}
          columns={[f.columnLabel, f.columnValue]}
          rows={section.rows}
        />
      );
    case 'table':
      return <FallbackTable title={section.title} columns={section.columns} rows={section.rows} />;
    case 'list':
      return (
        <div className="flex flex-col gap-1">
          {section.title ? <p className="text-meta text-text-2">{section.title}</p> : null}
          <ul className="flex list-disc flex-col gap-1 pl-6">
            {section.items.map((item, i) => (
              <li key={i} className="break-words">
                {item}
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

/**
 * Pengganti blok `aios-ui` yang tidak lolos validasi: keterangan singkat, data yang dikenali sebagai tabel/daftar,
 * dan JSON mentah hanya di balik "Lihat data mentah" yang tertutup.
 */
export function RichAnswerFallback({ code }: { code: string }) {
  const f = copy.richFallback;
  const sections = useMemo(() => richAnswerFallbackData(code), [code]);
  return (
    <section
      aria-label={f.region}
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-3"
    >
      <p className="text-ui text-text-2">{sections.length > 0 ? f.noteWithData : f.note}</p>
      {sections.map((section, i) => (
        <FallbackSection key={i} section={section} />
      ))}
      <details>
        <summary className="w-fit cursor-pointer text-meta text-text-2 hover:text-text">
          {f.showRaw}
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-panel border border-border bg-surface-2 p-3 font-mono text-meta whitespace-pre-wrap break-words text-text-2">
          {code}
        </pre>
      </details>
    </section>
  );
}
