import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';

/**
 * Aturan judul tunggal: di dalam Shell, Topbar adalah satu-satunya pemilik judul layar (h1). PageHeader layar
 * tidak merender judul sendiri; ia mendaftarkannya lewat konteks ini sehingga Topbar menampilkannya. Di luar
 * Shell (tes layar, katalog) konteks kosong dan PageHeader merender h2-nya seperti biasa.
 */
export const ScreenTitleContext = createContext<((title: string | null) => void) | null>(null);

/** Mendaftarkan judul ke Topbar; true bila judul didelegasikan (PageHeader tidak boleh merendernya lagi). */
export function useScreenTitle(title: ReactNode): boolean {
  const setTitle = useContext(ScreenTitleContext);
  const text = typeof title === 'string' && title !== '' ? title : null;
  const delegated = setTitle !== null && text !== null;
  useLayoutEffect(() => {
    if (!delegated) return;
    setTitle(text);
    return () => setTitle(null);
  }, [delegated, setTitle, text]);
  return delegated;
}
