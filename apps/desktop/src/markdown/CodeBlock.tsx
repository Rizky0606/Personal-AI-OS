import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { IconButton } from '../ui/IconButton';

export interface CodeBlockProps {
  /** Bahasa atau path berkas; kosong bila tidak disebut. */
  language: string;
  code: string;
}

const RESET_MS = 1_500;

/** Header berisi bahasa dan tombol salin; isi mono 13 px yang bisa digulir mendatar. */
export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

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

  return (
    <figure className="overflow-hidden rounded-control border border-border bg-surface">
      <figcaption className="flex h-8 items-center justify-between border-b border-border bg-surface-2 pr-1 pl-3">
        <span className="font-mono text-caption text-text-2">{language || 'teks'}</span>
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
      </figcaption>
      <pre className="overflow-x-auto p-3 font-mono text-ui text-text">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
