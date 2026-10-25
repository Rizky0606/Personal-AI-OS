import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { isTauri } from '../lib/tauri';
import { type ArtifactKind, type ArtifactTheme, buildArtifactPage } from './artifact';

/** Warna token aktif dibaca dari variabel CSS dokumen, jadi halaman artifact mengikuti tema terang atau gelap. */
export function currentArtifactTheme(): ArtifactTheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const read = (name: string) => style.getPropertyValue(`--aios-${name}`).trim();
  const attr = root.getAttribute('data-theme');
  const dark = attr
    ? attr === 'dark'
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  return {
    dark,
    bg: read('bg'),
    surface: read('surface'),
    text: read('text'),
    text2: read('text-2'),
    border: read('border'),
    accent: read('accent'),
    danger: read('danger'),
  };
}

type Frame = { kind: 'src'; url: string } | { kind: 'doc'; html: string } | { kind: 'error' };

export interface ArtifactPreviewProps {
  kind: ArtifactKind;
  code: string;
  className?: string;
}

/**
 * Menjalankan artifact di iframe sandbox tanpa allow-same-origin. Di Tauri halaman disajikan dari origin
 * `aiosartifact` (CSP aplikasi melarang skrip inline, termasuk di srcdoc); di peramban biasa (`vite dev`, E2E) cukup
 * srcdoc karena tidak ada CSP aplikasi.
 */
export function ArtifactPreview({ kind, code, className }: ArtifactPreviewProps) {
  const [frame, setFrame] = useState<Frame | null>(null);

  useEffect(() => {
    let alive = true;
    const html = buildArtifactPage(kind, code, currentArtifactTheme());
    if (!isTauri()) {
      setFrame({ kind: 'doc', html });
      return;
    }
    invoke<string>('artifact_put', { html })
      .then((id) => alive && setFrame({ kind: 'src', url: convertFileSrc(id, 'aiosartifact') }))
      .catch(() => alive && setFrame({ kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [kind, code]);

  if (frame?.kind === 'error') {
    return <p className="p-3 text-ui text-danger">{copy.chat.artifact.failed}</p>;
  }
  return (
    <iframe
      title={copy.chat.artifact.frameTitle}
      // Kode buatan AI: boleh berjalan, tetapi di origin buram tanpa akses ke aplikasi, form, atau jendela baru.
      sandbox="allow-scripts allow-modals"
      referrerPolicy="no-referrer"
      {...(frame?.kind === 'src' ? { src: frame.url } : {})}
      {...(frame?.kind === 'doc' ? { srcDoc: frame.html } : {})}
      className={cn('block w-full border-0 bg-bg', className)}
    />
  );
}
