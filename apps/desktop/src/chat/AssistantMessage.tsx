import type { RoleInfo } from '../api/gateway';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { cn } from '../lib/cn';
import { Bot } from 'lucide-react';
import { Markdown } from '../markdown/Markdown';
import { ReasoningBlock } from './ReasoningBlock';
import { RoleChip } from './RoleChip';
import { ToolStepRow, type ToolStepView } from './ToolStepRow';

export type AssistantPart =
  { type: 'text'; text: string } | ({ type: 'tool'; id: string } & ToolStepView);

export interface AssistantMessageProps {
  parts: AssistantPart[];
  reasoning?: string | undefined;
  role: string | null;
  model: string | null;
  roles: RoleInfo[];
  onChangeRole?: ((role: string) => void) | undefined;
  /** Jawaban masih mengalir. */
  streaming?: boolean;
  /** Meminta konfirmasi hapus jawaban ini beserta sesudahnya. */
  onDelete?: (() => void) | undefined;
}

/** Tiga titik yang memudar bergiliran selama jawaban masih ditulis. */
function TypingDots() {
  return (
    <span aria-hidden="true" className="aios-dots inline-flex h-4 items-center gap-1">
      <span className="size-1.5 rounded-full bg-accent shadow-glow" />
      <span className="size-1.5 rounded-full bg-accent shadow-glow" />
      <span className="size-1.5 rounded-full bg-accent shadow-glow" />
    </span>
  );
}

/** Avatar bot dengan titik status: hijau saat jawaban selesai, cyan berdenyut saat masih ditulis. */
function BotAvatar({ streaming }: { streaming: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-control bg-bg text-accent shadow-glow"
    >
      <Bot size={16} strokeWidth={1.5} />
      <span
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-surface',
          streaming ? 'animate-aios-breathe bg-accent' : 'bg-success',
        )}
      />
    </span>
  );
}

/** Kartu jawaban: avatar, nama, chip role, dan model di atas; teks sampai 72 karakter per baris. */
export function AssistantMessage({
  parts,
  reasoning,
  role,
  model,
  roles,
  onChangeRole,
  streaming = false,
  onDelete,
}: AssistantMessageProps) {
  return (
    <article
      aria-busy={streaming}
      className="group flex animate-aios-rise flex-col gap-3 rounded-panel border border-border bg-surface p-4 shadow-lift"
    >
      <header className="flex items-center gap-2">
        <BotAvatar streaming={streaming} />
        <span className="text-ui font-semibold text-text">{copy.chat.assistantName}</span>
        <RoleChip
          role={role}
          roles={roles}
          active={streaming}
          {...(onChangeRole ? { onChange: onChangeRole } : {})}
        />
        {model ? (
          <span className="rounded-badge bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-text-2">
            {model}
          </span>
        ) : null}
        {onDelete ? (
          <Button
            variant="ghost"
            onClick={onDelete}
            className="ml-auto opacity-0 transition-opacity duration-[120ms] group-focus-within:opacity-100 group-hover:opacity-100"
          >
            {copy.chat.deleteMessage}
          </Button>
        ) : null}
      </header>
      {reasoning ? <ReasoningBlock text={reasoning} /> : null}
      {parts.map((part, i) =>
        part.type === 'tool' ? (
          <ToolStepRow key={part.id} {...part} />
        ) : part.text ? (
          <Markdown key={i} source={part.text} />
        ) : null,
      )}
      {streaming ? <TypingDots /> : null}
    </article>
  );
}
