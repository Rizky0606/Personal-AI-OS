import { createHmac, randomBytes } from 'node:crypto';

/** TOTP RFC 6238 (HMAC-SHA1, 6 digit, langkah 30 detik): yang didukung semua aplikasi autentikator. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('karakter base32 tidak valid');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secret 160 bit (20 byte), ukuran yang disarankan RFC 4226. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export const timeStep = (atMs: number) => Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);

export function totpCode(secretBase32: string, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Mengembalikan time-step yang cocok (jendela ±1 langkah untuk selisih jam), atau null.
 * Seluruh kandidat selalu dihitung dan dibandingkan tanpa berhenti di yang pertama cocok.
 */
export function matchTotp(secretBase32: string, code: string, atMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(atMs);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (constantTimeEqual(totpCode(secretBase32, step), code)) matched = step;
  }
  return matched;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** URI otpauth:// yang dipindai aplikasi autentikator. */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
