import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** Kunci terpisah per tujuan, diturunkan dari satu AUTH_SECRET lewat HKDF-SHA256. */
export interface AuthKeys {
  /** Tanda tangan HS256 untuk access token. */
  jwt: Uint8Array;
  /** Enkripsi AES-256-GCM untuk secret TOTP di database. */
  totp: Buffer;
}

export function deriveAuthKeys(authSecret: string): AuthKeys {
  const derive = (info: string) =>
    Buffer.from(hkdfSync('sha256', authSecret, 'aios-gateway', info, 32));
  return { jwt: new Uint8Array(derive('jwt-hs256')), totp: derive('totp-secret-aes256gcm') };
}

const b64 = (b: Buffer) => b.toString('base64url');

/** Format: iv.tag.ciphertext (base64url). */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [b64(iv), b64(cipher.getAuthTag()), b64(body)].join('.');
}

/** Melempar bila data diubah atau kunci salah (AUTH_SECRET berganti). */
export function decryptSecret(key: Buffer, encoded: string): string {
  const [iv, tag, body] = encoded.split('.').map((p) => Buffer.from(p ?? '', 'base64url'));
  if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) {
    throw new Error('format secret terenkripsi tidak valid');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
