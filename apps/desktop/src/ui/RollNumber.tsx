import { useEffect, useRef, useState } from 'react';

/**
 * Angka yang berganti dengan animasi gulir 180 ms: angka baru naik dari bawah sementara yang lama keluar ke atas.
 * Lebar mengikuti angka terbaru (tabular), jadi teks di sekitarnya tidak bergoyang. Tanpa animasi saat gerak dikurangi
 * (aturan universal di styles.css).
 */
export function RollNumber({ value }: { value: number }) {
  const [previous, setPrevious] = useState<number | null>(null);
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    setPrevious(last.current);
    last.current = value;
    const timer = setTimeout(() => setPrevious(null), 180);
    return () => clearTimeout(timer);
  }, [value]);
  return (
    <span className="relative inline-flex overflow-hidden tabular-nums" data-roll>
      <span key={value} className={previous === null ? undefined : 'aios-roll-in'}>
        {value}
      </span>
      {previous === null ? null : (
        <span aria-hidden="true" className="aios-roll-out absolute inset-0">
          {previous}
        </span>
      )}
    </span>
  );
}
