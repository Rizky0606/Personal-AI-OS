import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockServer {
  url: string;
  requests: { method: string; url: string; authorization: string | undefined }[];
  close(): Promise<void>;
}

/** Server HTTP lokal yang menggantikan Hermes, 9Router, atau SearXNG di tes. */
export async function startMockServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<MockServer> {
  const requests: MockServer['requests'] = [];
  const server: Server = createServer((req, res) => {
    requests.push({
      method: req.method ?? '',
      url: req.url ?? '',
      authorization: req.headers.authorization,
    });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const ok =
  (body = 'ok') =>
  (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(body);
  };
