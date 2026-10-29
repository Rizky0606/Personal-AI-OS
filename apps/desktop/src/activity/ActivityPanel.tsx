import { FileDiff, FileText, Loader } from 'lucide-react';
import { useMemo } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { useUiStore } from '../state/uiStore';
import { EmptyState } from '../ui/EmptyState';
import { currentStep, fileActivities, otherSteps } from './activity';
import { SubagentTree } from './SubagentTree';

/**
 * Tab Aktivitas: apa yang sedang dilakukan agent sekarang, berkas apa yang ia baca atau ubah (yang terakhir
 * disentuh di atas), dan langkah lain seperti pencarian dan perintah. Datanya dari langkah tool pesan terbaru.
 */
export function ActivityPanel() {
  const steps = useUiStore((s) => s.agentSteps);
  const requestFile = useUiStore((s) => s.requestFile);
  const openPanel = useUiStore((s) => s.openPanel);
  const subagents = useUiStore((s) => s.agentSubagents);
  const files = useMemo(() => fileActivities(steps), [steps]);
  const others = useMemo(() => otherSteps(steps), [steps]);
  const now = currentStep(steps);

  if (steps.length === 0) return <EmptyState message={copy.activity.empty} />;

  return (
    <div className="flex animate-aios-enter flex-col gap-5 p-4">
      <section aria-label={copy.activity.now} className="flex flex-col gap-2">
        <h3 className="text-meta font-medium text-text-2">{copy.activity.now}</h3>
        <div className="rounded-panel border border-border bg-surface-2 px-3 py-2.5">
          {now ? (
            <p className="flex items-center gap-2 font-mono text-ui text-text">
              <Loader
                size={14}
                strokeWidth={1.5}
                aria-hidden="true"
                className="shrink-0 animate-aios-breathe text-accent"
              />
              <span className="shrink-0">{now.name}</span>
              {now.target ? (
                <span className="min-w-0 truncate text-text-2">{now.target}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-ui text-text-3">{copy.activity.idle}</p>
          )}
        </div>
      </section>

      <section aria-label={copy.activity.files} className="flex flex-col gap-2">
        <h3 className="text-meta font-medium text-text-2">{copy.activity.files}</h3>
        {files.length === 0 ? (
          <p className="text-ui text-text-3">{copy.activity.noFiles}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {files.map((file) => (
              <li
                key={file.path}
                className="group flex min-h-9 animate-aios-enter items-center gap-2 rounded-control px-2 transition-colors duration-[120ms] ease-aios hover:bg-surface-2"
              >
                <button
                  type="button"
                  aria-label={`${copy.activity.open}: ${file.path}`}
                  onClick={() => {
                    requestFile(file.path);
                    openPanel('files');
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                >
                  <FileText
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className="shrink-0 text-text-3"
                  />
                  <span className="min-w-0 truncate font-mono text-ui text-text">{file.path}</span>
                </button>
                {file.running ? (
                  <span
                    role="img"
                    aria-label={copy.runStatus.running}
                    className="size-2 shrink-0 animate-aios-breathe rounded-full bg-accent"
                  />
                ) : null}
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-caption',
                    file.action === 'edit'
                      ? 'bg-accent-soft text-text'
                      : 'bg-surface-2 text-text-2',
                  )}
                >
                  {file.action === 'edit' ? copy.activity.edit : copy.activity.read}
                </span>
                {file.action === 'edit' ? (
                  <button
                    type="button"
                    aria-label={`${copy.activity.diff}: ${file.path}`}
                    onClick={() => openPanel('diff')}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-2 transition-colors duration-[120ms] ease-aios hover:bg-surface hover:text-text"
                  >
                    <FileDiff size={14} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {others.length > 0 ? (
        <section aria-label={copy.activity.steps} className="flex flex-col gap-2">
          <h3 className="text-meta font-medium text-text-2">{copy.activity.steps}</h3>
          <ul className="flex flex-col gap-1.5">
            {others.map((step) => (
              <li
                key={step.id}
                className="flex min-w-0 animate-aios-enter items-center gap-2 font-mono text-ui"
              >
                <span className="shrink-0 rounded-badge bg-surface-2 px-1.5 py-0.5 text-text">
                  {step.name}
                </span>
                <span className="min-w-0 truncate text-text-2">{step.target}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {subagents.length > 0 ? <SubagentTree subagents={subagents} /> : null}
    </div>
  );
}
