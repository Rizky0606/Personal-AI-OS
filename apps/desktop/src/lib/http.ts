import { isTauri } from './tauri';

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * HTTP lewat plugin Tauri (klien Rust), bukan fetch webview: gateway menutup CORS dan hanya
 * mengizinkan klien aplikasi. Di peramban biasa (pengembangan UI) jatuh ke fetch bawaan.
 */
export const httpFetch: Fetcher = async (input, init) => {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(input, init);
  }
  return fetch(input, init);
};
