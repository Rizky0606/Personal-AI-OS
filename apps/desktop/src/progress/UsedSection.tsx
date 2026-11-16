import { Brain, ChevronDown, Cpu, Paperclip, Plug, Sparkles, Wrench } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import type { ProgressUsed } from '../realtime/progress';

const ICON = { size: 14, strokeWidth: 1.5, 'aria-hidden': true } as const;

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-ui">
      <dt className="flex w-32 shrink-0 items-center gap-2 text-text-2">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right text-text">{children}</dd>
    </div>
  );
}

/** Apakah ada sesuatu yang layak ditampilkan di bagian "Digunakan dalam sesi ini". */
export const hasUsed = (used: ProgressUsed): boolean =>
  used.uploads.length > 0 ||
  used.skills.length > 0 ||
  used.memory.read > 0 ||
  used.engine !== null ||
  used.tools.length > 0 ||
  used.connectors.length > 0;

/**
 * Baris ikon + label + nilai di kanan: Unggahan (nama pertama + "+N"), Skill, Memori ("Dibaca · N fakta" atau
 * "N dari M" bila sebagian tidak ikut; klik membuka cara pemilihan dan judul fakta beserta alasannya, bukan isinya),
 * Mesin dan model, Alat, dan Konektor MCP hanya bila ada datanya.
 */
export function UsedSection({ used }: { used: ProgressUsed }) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const listId = useId();
  const u = copy.progress.used;
  const memoryRead = u.memoryRead(used.memory.read, used.memory.total);
  const engine = [used.engine, used.model].filter(Boolean).join(' · ');
  return (
    <dl aria-label={copy.progress.sections.used} className="flex flex-col gap-2">
      {used.uploads.length > 0 ? (
        <Row icon={<Paperclip {...ICON} />} label={u.uploads}>
          <span className="inline-flex max-w-full items-baseline justify-end gap-1">
            <span className="truncate">{used.uploads[0]!.name}</span>
            {used.uploads.length > 1 ? (
              <span className="shrink-0 font-mono text-meta text-text-3">
                {u.more(used.uploads.length - 1)}
              </span>
            ) : null}
          </span>
        </Row>
      ) : null}
      {used.skills.length > 0 ? (
        <Row icon={<Sparkles {...ICON} />} label={u.skills}>
          <span className="block truncate" title={used.skills.join(', ')}>
            {used.skills.join(', ')}
          </span>
        </Row>
      ) : null}
      {used.memory.read > 0 ? (
        <Row icon={<Brain {...ICON} />} label={u.memory}>
          {used.memory.items.length > 0 ? (
            <button
              type="button"
              aria-expanded={memoryOpen}
              aria-controls={listId}
              onClick={() => setMemoryOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-control text-text underline decoration-border-strong underline-offset-2"
            >
              {memoryRead}
              <ChevronDown
                size={12}
                strokeWidth={1.5}
                aria-hidden="true"
                className={cn(
                  'transition-transform duration-[180ms] ease-aios',
                  memoryOpen && 'rotate-180',
                )}
              />
            </button>
          ) : (
            memoryRead
          )}
        </Row>
      ) : null}
      {memoryOpen && used.memory.items.length > 0 ? (
        <div id={listId} className="ml-6 flex flex-col gap-1 border-l border-border pl-3 text-meta">
          {used.memory.mode ? (
            <p className="text-text-3">{u.memoryMode[used.memory.mode]}</p>
          ) : null}
          <ul aria-label={u.memoryList} className="flex flex-col gap-1 text-text-2">
            {used.memory.items.map((item) => (
              <li key={item.id} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {item.via ? (
                  <span className="shrink-0 text-text-3">{u.memoryVia[item.via]}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {used.engine !== null ? (
        <Row icon={<Cpu {...ICON} />} label={u.engine}>
          <span className="block truncate font-mono text-meta">{engine}</span>
        </Row>
      ) : null}
      {used.tools.length > 0 ? (
        <Row icon={<Wrench {...ICON} />} label={u.tools}>
          {used.tools.map((tool) => copy.progress.tools[tool]).join(', ')}
        </Row>
      ) : null}
      {used.connectors.length > 0 ? (
        <Row icon={<Plug {...ICON} />} label={u.connectors}>
          {used.connectors.join(', ')}
        </Row>
      ) : null}
    </dl>
  );
}
