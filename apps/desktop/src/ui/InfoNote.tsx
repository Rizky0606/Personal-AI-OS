/** Catatan petunjuk biasa (bukan keadaan kosong): satu kalimat tanpa aksi, mis. isi sidebar yang informatif. */
export function InfoNote({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-start gap-4 p-6">
      <p className="max-w-[56ch] text-ui text-text-2">{message}</p>
    </div>
  );
}
