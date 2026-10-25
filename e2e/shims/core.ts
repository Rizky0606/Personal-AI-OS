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
    case 'artifact_put':
      // Pengganti protocol `aiosartifact`: halaman disajikan sebagai blob URL; ID-nya adalah URL itu sendiri.
      return URL.createObjectURL(new Blob([String(args.html)], { type: 'text/html' })) as T;
    case 'worker_connect_info': {
      // Worker baru per halaman (token berantai sekali pakai), seperti Tauri memulai ulang sidecar.
      const res = await fetch(`${controlUrl()}/worker/start`, { method: 'POST' });
      return (await res.json()) as T;
    }
    default:
      throw new Error(`E2E: perintah Tauri tidak dikenal: ${cmd}`);
  }
}

/** Pengganti `convertFileSrc`: hanya dipakai pratinjau artifact, yang ID-nya sudah berupa blob URL di E2E. */
export function convertFileSrc(path: string, protocol = 'asset'): string {
  if (protocol !== 'aiosartifact') throw new Error(`E2E: protocol tidak dikenal: ${protocol}`);
  return path;
}
