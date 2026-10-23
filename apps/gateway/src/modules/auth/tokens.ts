import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { IdSchema, ScopeSchema, type DeviceKind, type Scope } from '@aios/contracts';
import { SignJWT, errors, jwtVerify } from 'jose';
import { AppError } from '../../errors.js';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const ISSUER = 'aios-gateway';
const AUDIENCE = 'aios';

/**
 * Scope menurut jenis perangkat: aplikasi (Android, desktop) memakai `app`; worker di PC
 * memakai `worker` dan `llm` (provider omp lewat /llm/v1, ARCHITECTURE.md "Proxy model").
 */
export const SCOPES_BY_KIND: Record<DeviceKind, readonly Scope[]> = {
  android: ['app'],
  desktop: ['app'],
  worker: ['worker', 'llm'],
};

export interface AccessClaims {
  deviceId: string;
  scopes: Scope[];
}

export async function signAccessToken(
  key: Uint8Array,
  claims: AccessClaims,
  nowMs: number,
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ scope: claims.scopes.join(' ') })
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
    .setSubject(claims.deviceId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TTL_SECONDS)
    .sign(key);
}

const unauthorized = (code: string, detail: string) =>
  new AppError(401, code, detail, undefined, { 'www-authenticate': 'Bearer' });

/** Melempar AppError 401: `token_expired` (klien boleh refresh) atau `invalid_token`. */
export async function verifyAccessToken(
  key: Uint8Array,
  token: string,
  nowMs: number,
): Promise<AccessClaims & { expiresAt: number }> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      currentDate: new Date(nowMs),
    });
    const deviceId = IdSchema.safeParse(payload.sub);
    const scopes = (typeof payload.scope === 'string' ? payload.scope : '')
      .split(' ')
      .filter(Boolean)
      .map((s) => ScopeSchema.safeParse(s));
    if (!deviceId.success || scopes.some((s) => !s.success)) {
      throw unauthorized('invalid_token', 'Token tidak valid.');
    }
    return {
      deviceId: deviceId.data,
      scopes: scopes.flatMap((s) => (s.success ? [s.data] : [])),
      expiresAt: (payload.exp ?? 0) * 1000,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof errors.JWTExpired) {
      throw unauthorized(
        'token_expired',
        'Access token kedaluwarsa. Perbarui dengan refresh token.',
      );
    }
    throw unauthorized('invalid_token', 'Token tidak valid.');
  }
}

/* Refresh token: `<deviceId>.<32 byte acak>`; yang disimpan hanya SHA-256-nya. */

export function generateRefreshToken(deviceId: string): { token: string; hash: string } {
  const token = `${deviceId}.${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashRefreshToken(token) };
}

export const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Mengambil ID perangkat dari token tanpa memercayainya; kecocokan hash tetap harus diperiksa. */
export function parseRefreshToken(token: string): { deviceId: string } | null {
  const [deviceId, secret, ...rest] = token.split('.');
  const id = IdSchema.safeParse(deviceId);
  if (!id.success || !secret || secret.length < 20 || rest.length > 0) return null;
  return { deviceId: id.data };
}

export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
