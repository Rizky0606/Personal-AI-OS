import type { QueueName } from '@aios/contracts';
import { ChevronDown, Network, X } from 'lucide-react';
import { useId, useState } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { isSettled, type LiveRun } from '../realtime/liveRun';
import { useUiStore } from '../state/uiStore';
import { IconButton } from '../ui/IconButton';
import { TodoPanel, todoProgress } from './TodoPanel';

export interface AgentHudProps {
  /** Run yang sedang (atau baru) berjalan; tanpa rencana, antrean, dan subagent HUD tidak tampil. */
  live: LiveRun | undefined;
  /** Menarik arahan dari antrean agent; tanpa ini tombol tarik tidak tampil. */
  onRemoveQueued?: ((queue: QueueName, text: string) => void) | undefined;
}

const badgeClass = 'rounded-badge px-1.5 py-0.5 font-mono text-caption text-text';

/**
 * Satu bilah yang bisa dilipat tepat di atas composer: rencana agent, arahan yang menunggu giliran, dan jumlah
 * subagent (membuka tab Aktivitas). Terbuka secara bawaan; hilang bila ketiganya kosong.
 */
export function AgentHud({ live, onRemoveQueued }: AgentHudProps) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const openPanel = useUiStore((s) => s.openPanel);
  const h = copy.chat.hud;

  const { done, total } = todoProgress(live?.todos ?? []);
  const steering = live?.queue.steering ?? [];
  const followUp = live?.queue.followUp ?? [];
  const queued = steering.length + followUp.length;
  const subagents = live?.subagents.length ?? 0;
  if (!live || (total === 0 && queued === 0 && subagents === 0)) return null;

  const summary = [
    total > 0 ? h.tasks(done, total) : null,
    queued > 0 ? h.queued(queued) : null,
    subagents > 0 ? h.subagents(subagents) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      aria-label={h.title}
      className="mx-auto mt-2 w-[calc(100%-4rem)] max-w-[calc(var(--aios-chat-measure)+2.5rem)] shrink-0 animate-aios-enter overflow-hidden rounded-panel border border-border bg-surface"
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control text-left"
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-2 shrink-0 rounded-full',
              isSettled(live.status) ? 'bg-text-3' : 'animate-aios-breathe bg-accent',
            )}
          />
          <span className="shrink-0 text-ui font-semibold text-text">{h.title}</span>
          <span className="min-w-0 truncate font-mono text-meta text-text-2">{summary}</span>
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            aria-hidden="true"
            className={cn(
              'ml-auto shrink-0 text-text-3 transition-transform duration-[180ms] ease-aios',
              open && 'rotate-180',
            )}
          />
        </button>
        {subagents > 0 ? (
          <button
            type="button"
            aria-label={h.openActivity(subagents)}
            onClick={() => openPanel('activity')}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control border border-border bg-surface-2 px-2 text-meta text-text-2 transition-colors duration-[120ms] ease-aios hover:border-border-strong hover:text-text"
          >
            <Network size={14} strokeWidth={1.5} aria-hidden="true" />
            {h.subagents(subagents)}
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          id={bodyId}
          className="flex animate-aios-enter flex-col gap-3 border-t border-border px-3 py-3"
        >
          <TodoPanel phases={live.todos} />
          {queued > 0 ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-meta font-medium text-text-2">{copy.chat.queue.title}</h3>
              <ul
                aria-label={copy.chat.queue.title}
                className="flex max-h-32 flex-col gap-1 overflow-y-auto text-meta text-text-2"
              >
                {steering.map((text, i) => (
                  <li key={`s${i}`} className="flex items-center gap-2">
                    <span className={cn(badgeClass, 'bg-accent-soft')}>
                      {copy.chat.queue.steering}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{text}</span>
                    {onRemoveQueued ? (
                      <IconButton
                        label={copy.chat.queue.remove(text)}
                        onClick={() => onRemoveQueued('steering', text)}
                      >
                        <X size={14} strokeWidth={1.5} aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </li>
                ))}
                {followUp.map((text, i) => (
                  <li key={`f${i}`} className="flex items-center gap-2">
                    <span className={cn(badgeClass, 'bg-surface-2')}>
                      {copy.chat.queue.followUp}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{text}</span>
                    {onRemoveQueued ? (
                      <IconButton
                        label={copy.chat.queue.remove(text)}
                        onClick={() => onRemoveQueued('followUp', text)}
                      >
                        <X size={14} strokeWidth={1.5} aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
