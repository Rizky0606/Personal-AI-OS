import { MAX_FILE_BYTES } from '@aios/contracts';
import { useCallback, useRef, useState } from 'react';
import type { FilePart } from '../api/gateway';
import { apiErrorMessage } from '../api/errors';
import { api } from '../app/services';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';

export interface PendingFile {
  /** ID lokal (sebelum ada ID server). */
  id: string;
  name: string;
  status: 'uploading' | 'ready' | 'error';
  part?: FilePart;
  error?: string;
}

/**
 * Lampiran di composer: tiap berkas langsung diunggah ke `/files` saat dipilih, ditempel, atau dilepas,
 * supaya Kirim tidak menunggu. Berkas yang gagal tetap tampil dengan alasannya sampai dihapus.
 */
export function useFileAttachments(online: boolean) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const counter = useRef(0);

  const update = (id: string, patch: Partial<PendingFile>) =>
    setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const add = useCallback(
    (picked: readonly File[]) => {
      for (const file of picked) {
        const id = `local-${++counter.current}`;
        if (file.size > MAX_FILE_BYTES) {
          setFiles((list) => [
            ...list,
            { id, name: file.name, status: 'error', error: copy.chat.files.tooLarge },
          ]);
          continue;
        }
        setFiles((list) => [...list, { id, name: file.name, status: 'uploading' }]);
        api
          .uploadFile(file)
          .then((record) =>
            update(id, {
              status: 'ready',
              part: { type: 'file', fileId: record.id, name: record.name, mime: record.mime },
            }),
          )
          .catch((error: unknown) =>
            update(id, {
              status: 'error',
              // Penolakan berkas dari server (jenis, ukuran, isi rusak) sudah berupa kalimat untuk pengguna.
              error:
                error instanceof ApiProblem && (error.status === 400 || error.status === 413)
                  ? error.message
                  : apiErrorMessage(error, online),
            }),
          );
      }
    },
    [online],
  );

  const remove = useCallback(
    (id: string) => setFiles((list) => list.filter((f) => f.id !== id)),
    [],
  );
  const clear = useCallback(() => setFiles([]), []);

  return {
    files,
    add,
    remove,
    clear,
    /** Part siap kirim (yang gagal tidak ikut). */
    parts: files.flatMap((f) => (f.status === 'ready' && f.part ? [f.part] : [])),
    uploading: files.some((f) => f.status === 'uploading'),
  };
}
