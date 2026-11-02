import { controlUrl } from './control';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Pengganti `fetch` plugin-http: permintaan diteruskan oleh server kendali (Node), jadi tidak terkena CORS
 * (gateway menutup CORS, sama seperti klien Rust di aplikasi asli).
 */
export async function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  // Base64 supaya body biner (multipart unggah berkas) tidak rusak lewat JSON.
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : bytesToBase64(new Uint8Array(await request.arrayBuffer()));
  const res = await window.fetch(`${controlUrl()}/http`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: request.url,
      method: request.method,
      headers: [...request.headers.entries()],
      body,
    }),
  });
  const wrapped = (await res.json()) as {
    status: number;
    statusText: string;
    headers: [string, string][];
    /** Base64: respons bisa biner (unduh berkas dan gambar). */
    body: string;
  };
  const empty = wrapped.status === 204 || wrapped.status === 205 || wrapped.status === 304;
  return new Response(empty ? null : base64ToBytes(wrapped.body), {
    status: wrapped.status,
    statusText: wrapped.statusText,
    headers: wrapped.headers,
  });
}
