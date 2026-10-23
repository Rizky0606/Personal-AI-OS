import type { DeviceKind, LoginResponseSchema, Scope, TokenPairSchema } from '@aios/contracts';
import type { z } from 'zod';
import type { Database } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { uuidv7 } from '../../lib/uuidv7.js';
import { writeAudit } from '../audit/repo.js';
import { toDeviceDto } from '../devices/dto.js';
import { dummyPasswordHash, verifyPassword } from './password.js';
import {
  consumeTotpStep,
  findDevice,
  getOwner,
  insertDevice,
  revokeDevice,
  rotateRefreshHash,
  touchDevice,
  type DeviceRow,
} from './repo.js';
import { decryptSecret, type AuthKeys } from './secrets.js';
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_MS,
  SCOPES_BY_KIND,
  generateRefreshToken,
  hashRefreshToken,
  hashesEqual,
  parseRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';
import { matchTotp } from './totp.js';

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type TokenPair = z.infer<typeof TokenPairSchema>;

export interface LoginInput {
  password: string;
  totp: string;
  device: { name: string; kind: DeviceKind };
  pushToken?: string | undefined;
}

/** Hasil autentikasi access token yang dipakai middleware. */
export interface AuthContext {
  deviceId: string;
  kind: DeviceKind;
  scopes: Scope[];
  /** Kedaluwarsa access token (ms epoch); koneksi WebSocket ditutup pada saat itu. */
  expiresAt: number;
}

export interface AuthService {
  login(input: LoginInput, meta: { ip: string }): Promise<LoginResponse>;
  refresh(refreshToken: string, meta: { ip: string }): Promise<TokenPair>;
  logout(deviceId: string): Promise<void>;
  authenticate(accessToken: string): Promise<AuthContext>;
  /** Perangkat masih ada dan belum dicabut; dipakai koneksi WebSocket yang berumur panjang. */
  deviceActive(deviceId: string): Promise<boolean>;
}

export interface AuthServiceDeps {
  db: Database;
  keys: AuthKeys;
  /** Jam (ms epoch); diganti di tes untuk menguji kedaluwarsa. */
  now?: () => number;
  log?: { warn(obj: object, msg: string): void };
}

const invalidCredentials = () =>
  new AppError(401, 'invalid_credentials', 'Password atau kode TOTP salah.');

const invalidRefresh = () =>
  new AppError(401, 'invalid_refresh_token', 'Refresh token tidak valid. Login ulang.');

export function createAuthService({ db, keys, now = Date.now, log }: AuthServiceDeps): AuthService {
  const accessFor = (device: DeviceRow) =>
    signAccessToken(keys.jwt, { deviceId: device.id, scopes: device.scopes as Scope[] }, now());

  /** Token lama dipakai ulang: perangkat dianggap bocor dan dicabut seluruhnya. */
  async function revokeForReuse(device: DeviceRow, ip: string): Promise<never> {
    await revokeDevice(db, device.id, new Date(now()));
    await writeAudit(db, {
      actorDeviceId: device.id,
      action: 'auth.refresh_reuse_detected',
      target: `device:${device.id} ip:${ip}`,
    });
    throw new AppError(
      401,
      'refresh_token_reused',
      'Refresh token lama dipakai ulang, jadi perangkat ini dicabut. Login ulang.',
    );
  }

  return {
    async login(input, { ip }) {
      const at = now();
      const owner = await getOwner(db);

      // Password dan TOTP selalu dihitung keduanya; tidak ada petunjuk mana yang salah.
      const passwordOk =
        (await verifyPassword(
          owner?.passwordHash ?? (await dummyPasswordHash()),
          input.password,
        )) && owner !== undefined;
      let step: number | null = null;
      if (owner) {
        try {
          step = matchTotp(decryptSecret(keys.totp, owner.totpSecretEnc), input.totp, at);
        } catch {
          log?.warn({}, 'secret TOTP tidak bisa didekripsi; AUTH_SECRET berubah?');
        }
      }

      // consumeTotpStep terakhir dan hanya bila password benar: kode tidak "terbakar" oleh tebakan.
      const accepted = passwordOk && step !== null && (await consumeTotpStep(db, step));
      if (!accepted) {
        await writeAudit(db, {
          actorDeviceId: null,
          action: 'auth.login_failed',
          target: `ip:${ip}`,
        });
        throw invalidCredentials();
      }

      const id = uuidv7();
      const refresh = generateRefreshToken(id);
      const device = await insertDevice(db, {
        id,
        kind: input.device.kind,
        name: input.device.name,
        scopes: [...SCOPES_BY_KIND[input.device.kind]],
        pushToken: input.pushToken ?? null,
        tokenHash: refresh.hash,
        refreshExpiresAt: new Date(at + REFRESH_TTL_MS),
        lastSeenAt: new Date(at),
      });
      await writeAudit(db, {
        actorDeviceId: device.id,
        action: 'auth.login',
        target: `device:${device.id} ip:${ip}`,
      });

      return {
        accessToken: await accessFor(device),
        refreshToken: refresh.token,
        expiresIn: ACCESS_TTL_SECONDS,
        device: toDeviceDto(device),
      };
    },

    async refresh(refreshToken, { ip }) {
      const parsed = parseRefreshToken(refreshToken);
      if (!parsed) throw invalidRefresh();
      const device = await findDevice(db, parsed.deviceId);
      if (!device || device.revokedAt) throw invalidRefresh();

      if (!hashesEqual(hashRefreshToken(refreshToken), device.tokenHash)) {
        return revokeForReuse(device, ip);
      }
      const at = now();
      if (device.refreshExpiresAt.getTime() <= at) {
        throw new AppError(401, 'refresh_token_expired', 'Refresh token kedaluwarsa. Login ulang.');
      }

      const next = generateRefreshToken(device.id);
      const rotated = await rotateRefreshHash(db, {
        id: device.id,
        oldHash: device.tokenHash,
        newHash: next.hash,
        expiresAt: new Date(at + REFRESH_TTL_MS),
      });
      // Kalah balapan dengan refresh lain memakai token yang sama: sama dengan pemakaian ulang.
      if (!rotated) return revokeForReuse(device, ip);

      return {
        accessToken: await accessFor(rotated),
        refreshToken: next.token,
        expiresIn: ACCESS_TTL_SECONDS,
      };
    },

    async logout(deviceId) {
      if (await revokeDevice(db, deviceId, new Date(now()))) {
        await writeAudit(db, {
          actorDeviceId: deviceId,
          action: 'auth.logout',
          target: `device:${deviceId}`,
        });
      }
    },

    async authenticate(accessToken) {
      const at = now();
      const claims = await verifyAccessToken(keys.jwt, accessToken, at);
      const device = await findDevice(db, claims.deviceId);
      if (!device || device.revokedAt) {
        throw new AppError(401, 'invalid_token', 'Perangkat sudah dicabut.', undefined, {
          'www-authenticate': 'Bearer',
        });
      }
      await touchDevice(db, device.id, new Date(at));
      return {
        deviceId: device.id,
        kind: device.kind,
        scopes: claims.scopes,
        expiresAt: claims.expiresAt,
      };
    },

    async deviceActive(deviceId) {
      const device = await findDevice(db, deviceId);
      return !!device && !device.revokedAt;
    },
  };
}
