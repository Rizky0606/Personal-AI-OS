import type { RoleInfo } from '../api/gateway';
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
}: AssistantMessageProps) {
  return (
    <article aria-busy={streaming} className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <RoleChip role={role} roles={roles} {...(onChangeRole ? { onChange: onChangeRole } : {})} />
        {model ? <span className="font-mono text-caption text-text-3">{model}</span> : null}
      </header>
      {reasoning ? <ReasoningBlock text={reasoning} /> : null}
      {parts.map((part, i) =>
        part.type === 'tool' ? (
          <ToolStepRow key={part.id} {...part} />
        ) : part.text ? (
          <Markdown key={i} source={part.text} />
        ) : null,
      )}
    </article>
  );
}
