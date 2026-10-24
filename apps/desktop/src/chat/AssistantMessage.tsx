import type { RoleInfo } from '../api/gateway';
import { copy } from '../copy';
import { Button } from '../ui/Button';
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

/** Tanpa gelembung: chip role dan model kecil di atas, lalu teks penuh lebar sampai 72 karakter. */
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
    <article aria-busy={streaming} className="group flex animate-aios-rise flex-col gap-2">
      <header className="flex items-center gap-2">
        <RoleChip
          role={role}
          roles={roles}
          active={streaming}
          {...(onChangeRole ? { onChange: onChangeRole } : {})}
        />
        {model ? <span className="font-mono text-caption text-text-3">{model}</span> : null}
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
