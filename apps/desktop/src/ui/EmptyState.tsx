import type { ReactElement } from 'react';

export interface EmptyStateProps {
  message: string;
  /**
   * Wajib: satu tombol aksi yang relevan (buat, tambah, mulai, muat ulang, buka pengaturan).
   * Keadaan kosong tanpa jalan keluar tidak boleh ada; teks petunjuk biasa memakai InfoNote.
   */
  action: ReactElement;
}

/** Satu kalimat tentang apa yang bisa dilakukan, plus satu aksi; tanpa ilustrasi. */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-4 p-6">
      <p className="max-w-[56ch] text-ui text-text-2">{message}</p>
      {action}
    </div>
  );
}
