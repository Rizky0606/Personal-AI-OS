import * as Dialog from '@radix-ui/react-dialog';
import { Check, Code2, Copy, Maximize2, Play, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { copy } from '../copy';
import { IconButton } from '../ui/IconButton';
import { artifactKind } from './artifact';
import { ArtifactPreview } from './ArtifactPreview';

export interface CodeBlockProps {
  /** Bahasa atau path berkas; kosong bila tidak disebut. */
  language: string;
  code: string;
  /** Pagar penutup sudah ada (jawaban selesai ditulis); pratinjau hanya untuk blok yang lengkap. */
  closed?: boolean;
}

const RESET_MS = 1_500;

/**
 * Header berisi bahasa dan tombol salin; isi mono 13 px yang bisa digulir mendatar. Blok HTML, SVG, React, dan
 * Mermaid yang lengkap mendapat tombol Pratinjau (diagram Mermaid langsung tampil sebagai pratinjau).
 */
export function CodeBlock({ language, code, closed = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const kind = useMemo(
    () => (closed ? artifactKind(language, code) : null),
    [closed, language, code],
  );
  const [previewing, setPreviewing] = useState(kind === 'mermaid');
  const [expanded, setExpanded] = useState(false);
  const a = copy.chat.artifact;

  // Blok yang baru selesai ditulis: Mermaid langsung dipratinjau.
  useEffect(() => {
    if (kind === 'mermaid') setPreviewing(true);
  }, [kind]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return; // Clipboard ditolak: tombol tidak berpura-pura berhasil.
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), RESET_MS);
  }

  const showPreview = kind !== null && previewing;
  return (
    <figure className="overflow-hidden rounded-control border border-border bg-surface">
      <figcaption className="flex h-8 items-center justify-between border-b border-border bg-surface-2 pr-1 pl-3">
        <span className="font-mono text-caption text-text-2">{language || 'teks'}</span>
        <span className="flex items-center">
          {kind ? (
            <>
              <IconButton
                label={showPreview ? a.showCode : a.preview}
                aria-pressed={showPreview}
                onClick={() => setPreviewing((v) => !v)}
              >
                {showPreview ? (
                  <Code2 size={14} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <Play size={14} strokeWidth={1.5} aria-hidden="true" />
                )}
              </IconButton>
              <IconButton label={a.expand} onClick={() => setExpanded(true)}>
                <Maximize2 size={14} strokeWidth={1.5} aria-hidden="true" />
              </IconButton>
            </>
          ) : null}
          <IconButton
            label={copied ? copy.chat.copied : copy.chat.copy}
            onClick={() => void onCopy()}
          >
            {copied ? (
              <Check size={14} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
          </IconButton>
        </span>
      </figcaption>
      {showPreview && kind ? (
        <ArtifactPreview kind={kind} code={code} className="h-96" />
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-ui text-text">
          <code>{code}</code>
        </pre>
      )}
      {kind ? (
        <Dialog.Root open={expanded} onOpenChange={setExpanded}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 animate-aios-fade bg-bg/60" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-6 z-50 flex animate-aios-dialog flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-float"
            >
              <div className="flex h-10 items-center justify-between border-b border-border pr-1 pl-4">
                <Dialog.Title className="text-ui font-semibold text-text">
                  {a.dialogTitle(language)}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <IconButton label={a.close}>
                    <X size={16} strokeWidth={1.5} aria-hidden="true" />
                  </IconButton>
                </Dialog.Close>
              </div>
              <ArtifactPreview kind={kind} code={code} className="min-h-0 flex-1" />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </figure>
  );
}
