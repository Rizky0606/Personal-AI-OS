import { createHash } from 'node:crypto';
import { SignJWT, decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors.js';
import { hashPassword, verifyPassword } from './password.js';
import { decryptSecret, deriveAuthKeys, encryptSecret } from './secrets.js';
import {
  ACCESS_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
  hashesEqual,
  parseRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

const DEVICE = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const keys = deriveAuthKeys('a'.repeat(48));
const T0 = Date.UTC(2026, 9, 22, 6, 0, 0);

describe('password argon2id', () => {
  it('menghasilkan hash PHC argon2id dengan salt berbeda dan password asli tidak terlihat', async () => {
    const a = await hashPassword('correct-horse-battery');
    const b = await hashPassword('correct-horse-battery');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct-horse');
  });

  it('memverifikasi password benar dan menolak yang salah atau hash rusak', async () => {
    const h = await hashPassword('correct-horse-battery');
    expect(await verifyPassword(h, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(h, 'correct-horse-batterY')).toBe(false);
    expect(await verifyPassword('bukan-hash', 'apa pun')).toBe(false);
  });
});

describe('enkripsi secret TOTP', () => {
  it('bolak-balik, dan setiap enkripsi memakai IV berbeda', () => {
    const a = encryptSecret(keys.totp, 'JBSWY3DPEHPK3PXP');
    const b = encryptSecret(keys.totp, 'JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(keys.totp, a)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('gagal bila data diubah atau AUTH_SECRET berbeda', () => {
    const enc = encryptSecret(keys.totp, 'JBSWY3DPEHPK3PXP');
    const [iv, tag, body] = enc.split('.') as [string, string, string];
    const tampered = [iv, tag, `${body.slice(0, -2)}AA`].join('.');
    expect(() => decryptSecret(keys.totp, tampered)).toThrow();
    expect(() => decryptSecret(deriveAuthKeys('b'.repeat(48)).totp, enc)).toThrow();
    expect(() => decryptSecret(keys.totp, 'rusak')).toThrow();
  });

  it('kunci JWT dan kunci TOTP diturunkan terpisah', () => {
    expect(Buffer.from(keys.jwt).equals(keys.totp)).toBe(false);
  });
});

describe('access token JWT', () => {
  it('berisi sub, scope, dan masa berlaku tepat 15 menit', async () => {
    const token = await signAccessToken(keys.jwt, { deviceId: DEVICE, scopes: ['app'] }, T0);
    const claims = decodeJwt(token);
    expect(claims.sub).toBe(DEVICE);
    expect(claims.scope).toBe('app');
    expect(claims.iss).toBe('aios-gateway');
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(ACCESS_TTL_SECONDS);
    expect(ACCESS_TTL_SECONDS).toBe(900);
    expect(await verifyAccessToken(keys.jwt, token, T0 + 1000)).toEqual({
      deviceId: DEVICE,
      scopes: ['app'],
      expiresAt: (claims.exp ?? 0) * 1000,
    });
  });

  it('masih valid sampai detik terakhir dan kedaluwarsa sesudahnya (token_expired)', async () => {
    const token = await signAccessToken(keys.jwt, { deviceId: DEVICE, scopes: ['app'] }, T0);
    await expect(verifyAccessToken(keys.jwt, token, T0 + 899_000)).resolves.toBeDefined();
    await expect(verifyAccessToken(keys.jwt, token, T0 + 901_000)).rejects.toMatchObject({
      status: 401,
      code: 'token_expired',
    });
  });

  it('menolak tanda tangan salah, token rusak, dan algoritma none', async () => {
    const token = await signAccessToken(keys.jwt, { deviceId: DEVICE, scopes: ['app'] }, T0);
    const other = deriveAuthKeys('c'.repeat(48));
    await expect(verifyAccessToken(other.jwt, token, T0)).rejects.toMatchObject({
      code: 'invalid_token',
    });
    await expect(verifyAccessToken(keys.jwt, `${token}x`, T0)).rejects.toBeInstanceOf(AppError);
    await expect(verifyAccessToken(keys.jwt, 'a.b.c', T0)).rejects.toMatchObject({
      code: 'invalid_token',
    });

    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none' })}.${b64({
      sub: DEVICE,
      scope: 'app',
      iss: 'aios-gateway',
      aud: 'aios',
      jti: 'x',
      iat: T0 / 1000,
      exp: T0 / 1000 + 900,
    })}.`;
    await expect(verifyAccessToken(keys.jwt, none, T0)).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('menolak audience atau issuer salah, scope tak dikenal, dan sub bukan UUID', async () => {
    const forge = (
      { sub = DEVICE, ...claims }: Record<string, unknown>,
      aud = 'aios',
      iss = 'aios-gateway',
    ) =>
      new SignJWT({ scope: 'app', ...claims })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(sub))
        .setIssuer(iss)
        .setAudience(aud)
        .setJti('j')
        .setIssuedAt(T0 / 1000)
        .setExpirationTime(T0 / 1000 + 900)
        .sign(keys.jwt);

    for (const token of [
      await forge({}, 'lain'),
      await forge({}, 'aios', 'lain'),
      await forge({ scope: 'app admin' }),
      await forge({ sub: 'bukan-uuid' }),
    ]) {
      await expect(verifyAccessToken(keys.jwt, token, T0)).rejects.toMatchObject({
        code: 'invalid_token',
      });
    }
  });
});

describe('refresh token', () => {
  it('berformat <deviceId>.<acak>, unik, dan yang disimpan hanya SHA-256', () => {
    const a = generateRefreshToken(DEVICE);
    const b = generateRefreshToken(DEVICE);
    expect(a.token.startsWith(`${DEVICE}.`)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(createHash('sha256').update(a.token).digest('hex'));
    expect(a.hash).not.toContain(a.token.split('.')[1] ?? 'x');
    expect(a.token.split('.')[1]?.length).toBeGreaterThanOrEqual(43);
  });

  it('parse hanya menerima bentuk yang benar', () => {
    const { token } = generateRefreshToken(DEVICE);
    expect(parseRefreshToken(token)).toEqual({ deviceId: DEVICE });
    for (const bad of [
      '',
      'abc',
      `${DEVICE}`,
      `${DEVICE}.`,
      `${DEVICE}.pendek`,
      `x.${token}`,
      `${token}.lebih`,
    ]) {
      expect(parseRefreshToken(bad), bad).toBeNull();
    }
  });

  it('hashesEqual membandingkan hash dan menolak panjang berbeda atau kosong', () => {
    const { token, hash } = generateRefreshToken(DEVICE);
    expect(hashesEqual(hashRefreshToken(token), hash)).toBe(true);
    expect(hashesEqual(hashRefreshToken(`${token}x`), hash)).toBe(false);
    expect(hashesEqual('', '')).toBe(false);
    expect(hashesEqual('abcd', hash)).toBe(false);
  });
});
