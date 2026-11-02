import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../app/services';
import { copy } from '../copy';

const IMAGE = /^image\/(png|jpeg|webp|gif)$/i;
export const isPreviewableImage = (mime: string) => IMAGE.test(mime);

export interface LightboxFile {
  fileId: string;
  name: string;
  mime: string;
}

/**
 * Pratinjau layar penuh satu artifact (gambar); dipakai baris aktivitas di jawaban dan kartu Output panel Progres.
 * Mengambil byte lewat endpoint terautentikasi; Esc atau tombol Tutup menutup.
 */
export function ArtifactLightbox({ file, onClose }: { file: LightboxFile; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    setUrl(null);
    setFailed(false);
    api
      .downloadFile(file.fileId)
      .then((blob) => {
        created = URL.createObjectURL(blob);
        if (alive) setUrl(created);
        else URL.revokeObjectURL(created);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [file.fileId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 p-6"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <button
        autoFocus
        type="button"
        aria-label={copy.progress.lightbox.close}
        onClick={onClose}
        className="absolute top-4 right-4 rounded-control border border-border bg-surface p-2 text-text"
      >
        <X size={16} aria-hidden="true" />
      </button>
      {failed ? (
        <p role="alert">{copy.progress.lightbox.unavailable}</p>
      ) : url ? (
        isPreviewableImage(file.mime) ? (
          <img src={url} alt={file.name} className="max-h-[80vh] max-w-full" />
        ) : (
          <p>{copy.progress.lightbox.notImage(file.name)}</p>
        )
      ) : (
        <p role="status">{copy.progress.lightbox.loading}</p>
      )}
    </div>
  );
}
