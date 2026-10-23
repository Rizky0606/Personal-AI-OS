import { controlUrl } from './control';

const SECRET_PREFIX = 'e2e-secret:';

/** Pengganti `invoke` Tauri: perintah yang dipakai aplikasi desktop (keyring, nama perangkat, info worker). */
export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  switch (cmd) {
    case 'device_name':
      return 'PC uji E2E' as T;
    case 'secret_get':
      return (localStorage.getItem(SECRET_PREFIX + String(args.key)) ?? null) as T;
    case 'secret_set':
      localStorage.setItem(SECRET_PREFIX + String(args.key), String(args.value));
      return undefined as T;
    case 'secret_remove':
      localStorage.removeItem(SECRET_PREFIX + String(args.key));
      return undefined as T;
    case 'worker_connect_info': {
      // Worker baru per halaman (token berantai sekali pakai), seperti Tauri memulai ulang sidecar.
      const res = await fetch(`${controlUrl()}/worker/start`, { method: 'POST' });
      return (await res.json()) as T;
    }
    default:
      throw new Error(`E2E: perintah Tauri tidak dikenal: ${cmd}`);
  }
}
