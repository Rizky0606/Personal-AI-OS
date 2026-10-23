import { generateKeyPairSync } from 'node:crypto';
import type { ServiceAccount } from '../modules/push/fcm.js';
import { startMockServer, type MockServer } from './mock-server.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

export interface FcmSent {
  token: string;
  title: string | undefined;
  /** Seluruh isi `notification` (untuk membuktikan tidak ada body). */
  notification: Record<string, unknown>;
  data: Record<string, string>;
}

export interface FakeFcm {
  baseUrl: string;
  account: ServiceAccount;
  /** Pesan yang diterima server FCM palsu, berurutan. */
  sent: FcmSent[];
  /** Menentukan balasan untuk token tertentu (default 200). */
  replyFor: Map<string, { status: number; body: unknown }>;
  close(): Promise<void>;
}

/** Pengganti Google OAuth + FCM HTTP v1 untuk tes. */
export async function startFakeFcm(): Promise<FakeFcm> {
  const sent: FcmSent[] = [];
  const replyFor = new Map<string, { status: number; body: unknown }>();
  const server: MockServer = await startMockServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token') {
        return void res
          .writeHead(200)
          .end(JSON.stringify({ access_token: 'akses-uji', expires_in: 3600 }));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        message: {
          token: string;
          notification: Record<string, unknown>;
          data: Record<string, string>;
        };
      };
      sent.push({
        token: body.message.token,
        title: body.message.notification.title as string | undefined,
        notification: body.message.notification,
        data: body.message.data,
      });
      const reply = replyFor.get(body.message.token);
      if (reply) return void res.writeHead(reply.status).end(JSON.stringify(reply.body));
      res.writeHead(200).end(JSON.stringify({ name: 'projects/uji/messages/1' }));
    });
  });
  return {
    baseUrl: server.url,
    account: {
      project_id: 'proyek-uji',
      client_email: 'fcm@proyek-uji.iam.gserviceaccount.com',
      private_key: PRIVATE_PEM,
      token_uri: `${server.url}/token`,
    },
    sent,
    replyFor,
    close: () => server.close(),
  };
}
