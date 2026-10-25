import type { RoleInfo } from '../api/gateway';
import { copy } from '../copy';
import { Button } from '../ui/Button';
import { cn } from '../lib/cn';
import { Bot, Download, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOnline } from '../app/hooks';
import { api } from '../app/services';
import { useToastStore } from '../ui/Toaster';
import { saveBlob } from '../lib/external';
import { buildZip, extractCodeFiles, type CodeFile } from './codeArchive';
import { Markdown } from '../markdown/Markdown';
import { ReasoningBlock } from './ReasoningBlock';
import { RoleChip } from './RoleChip';
import { ToolStepRow, type ToolStepView } from './ToolStepRow';

export type AssistantPart =
  | { type: 'text'; text: string }
  | ({ type: 'tool'; id: string } & ToolStepView)
  /** Berkas buatan agent (folder kiriman) yang bisa diunduh. */
  | { type: 'file'; fileId: string; name: string; mime: string };

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

/** Berkas yang dibuat agent untuk pemilik; Unduh menyimpannya lewat gateway (GET /files/:id/download). */
function GeneratedFiles({ files }: { files: { fileId: string; name: string; mime: string }[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const online = useOnline();
  const push = useToastStore((s) => s.push);
  if (files.length === 0) return null;

  async function download(file: { fileId: string; name: string }) {
    setBusy(file.fileId);
    try {
      saveBlob(await api.downloadFile(file.fileId), file.name);
    } catch (error) {
      push(apiErrorMessage(error, online), 'danger');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul aria-label={copy.chat.generatedFiles} className="flex flex-col gap-2">
      {files.map((file) => (
        <li
          key={file.fileId}
          className="flex items-center gap-3 rounded-control border border-border bg-surface-2 px-3 py-2"
        >
          <FileText
            size={16}
            strokeWidth={1.5}
            aria-hidden="true"
            className="shrink-0 text-text-2"
          />
          <span className="min-w-0 flex-1 truncate text-ui text-text">{file.name}</span>
          <Button
            variant="secondary"
            disabled={busy === file.fileId}
            aria-label={`${copy.chat.downloadFile}: ${file.name}`}
            onClick={() => void download(file)}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            {busy === file.fileId ? copy.chat.downloading : copy.chat.downloadFile}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function downloadZip(files: CodeFile[]) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  saveBlob(new Blob([buildZip(files)], { type: 'application/zip' }), `kode-${stamp}.zip`);
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
  // Blok kode di jawaban yang sudah selesai bisa diunduh sekaligus sebagai satu zip (struktur folder ikut path).
  const files = useMemo(
    () =>
      streaming
        ? []
        : extractCodeFiles(parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n\n')),
    [parts, streaming],
  );
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
        ) : part.type === 'text' && part.text ? (
          <Markdown key={i} source={part.text} />
        ) : null,
      )}
      {streaming ? <TypingDots /> : null}
      <GeneratedFiles files={parts.flatMap((p) => (p.type === 'file' ? [p] : []))} />
      {!streaming && files.length > 0 ? (
        <footer className="flex items-center justify-end border-t border-border pt-3">
          <Button
            variant="secondary"
            onClick={() => downloadZip(files)}
            title={copy.chat.zip.hint(files.length)}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            {copy.chat.zip.download(files.length)}
          </Button>
        </footer>
      ) : null}
    </article>
  );
}
