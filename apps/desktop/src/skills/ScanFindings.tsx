import type { SkillScan } from '@aios/contracts';
import { copy } from '../copy';
import { cn } from '../lib/cn';

/** Hasil pemindai: putusan dalam teks (bukan warna saja), lalu baris yang ditandai. */
export function ScanFindings({ scan }: { scan: SkillScan }) {
  const t = copy.skillsPage.scanResult;
  return (
    <section
      aria-label={t.title}
      className={cn(
        'flex flex-col gap-2 rounded-control border p-3 text-meta',
        scan.verdict === 'safe' && 'border-border bg-surface-2 text-text-2',
        scan.verdict === 'warning' && 'border-warning text-text',
        scan.verdict === 'dangerous' && 'border-danger text-text',
      )}
    >
      <p className="font-medium">{t[scan.verdict]}</p>
      {scan.findings.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {scan.findings.map((f, i) => (
            <li key={`${f.rule}-${f.line}-${i}`} className="flex flex-col gap-0.5">
              <span>
                <span className="font-medium">{t.line(f.line)}</span> · {f.message}
              </span>
              <code className="truncate font-mono text-caption text-text-2" title={f.excerpt}>
                {f.excerpt}
              </code>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-caption text-text-3">{t.disclaimer}</p>
    </section>
  );
}
