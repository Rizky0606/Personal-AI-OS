import { useEffect, useRef } from 'react';
import { copy } from '../copy';
import { cn } from '../lib/cn';
import { inspectCommand, parseBridgeMessage, type BridgeMessage } from './bridge';

export type PreviewSize = 'phone' | 'tablet' | 'full';

/** Lebar viewport per ukuran (px); `full` memenuhi panel. */
export const SIZE_WIDTH: Record<PreviewSize, number | null> = {
  phone: 390,
  tablet: 768,
  full: null,
};

export interface PreviewFrameProps {
  /** Alamat proxy lokal worker. */
  url: string;
  size: PreviewSize;
  /** Dinaikkan untuk memuat ulang halaman. */
  reloadNonce: number;
  inspecting: boolean;
  onMessage: (message: BridgeMessage) => void;
}

/**
 * Iframe ke halaman preview (lewat proxy worker yang menyisipkan jembatan). Pesan jembatan hanya diterima
 * dari jendela iframe ini; mode inspeksi dikirim sebagai perintah ke jembatan.
 */
export function PreviewFrame({ url, size, reloadNonce, inspecting, onMessage }: PreviewFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    function listen(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const message = parseBridgeMessage(event.data);
      if (message) handler.current(message);
    }
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage(inspectCommand(inspecting), '*');
  }, [inspecting, reloadNonce]);

  const width = SIZE_WIDTH[size];
  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-surface-2 p-2">
      <iframe
        key={reloadNonce}
        ref={frame}
        src={url}
        title={copy.preview.frameTitle}
        // Halaman preview adalah kode project: boleh berjalan, tetapi tanpa akses ke aplikasi induk.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        style={width ? { width } : undefined}
        className={cn(
          'h-full min-h-0 rounded-control border border-border bg-bg',
          width ? 'shrink-0' : 'w-full',
        )}
      />
    </div>
  );
}
