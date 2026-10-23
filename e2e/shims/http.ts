import { controlUrl } from './control';

/**
 * Pengganti `fetch` plugin-http: permintaan diteruskan oleh server kendali (Node), jadi tidak terkena CORS
 * (gateway menutup CORS, sama seperti klien Rust di aplikasi asli).
 */
export async function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.text();
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
    body: string;
  };
  const empty = wrapped.status === 204 || wrapped.status === 205 || wrapped.status === 304;
  return new Response(empty ? null : wrapped.body, {
    status: wrapped.status,
    statusText: wrapped.statusText,
    headers: wrapped.headers,
  });
}
