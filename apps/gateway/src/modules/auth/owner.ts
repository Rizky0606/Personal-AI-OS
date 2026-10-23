import type { Database } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from './password.js';
import { ownerExists, revokeAllDevices, upsertOwner } from './repo.js';
import { encryptSecret, type AuthKeys } from './secrets.js';

export interface SaveOwnerInput {
  password: string;
  /** Secret TOTP base32 (lihat generateTotpSecret). */
  totpSecret: string;
  /** Mengganti akun yang ada dan mencabut semua perangkat. */
  reset?: boolean;
}

/**
 * Membuat akun pemilik (password argon2id + TOTP terenkripsi). Hanya satu akun: bila sudah ada,
 * butuh `reset`, yang juga mencabut semua perangkat karena kredensialnya berganti.
 */
export async function saveOwner(
  db: Database,
  keys: AuthKeys,
  input: SaveOwnerInput,
  now: () => number = Date.now,
): Promise<{ revokedDevices: number }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(400, 'weak_password', `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
  }
  const passwordHash = await hashPassword(input.password);
  const totpSecretEnc = encryptSecret(keys.totp, input.totpSecret);

  return db.transaction(async (tx) => {
    const exists = await ownerExists(tx);
    if (exists && !input.reset) {
      throw new AppError(
        409,
        'owner_exists',
        'Akun pemilik sudah ada. Gunakan --reset untuk menggantinya (semua perangkat dicabut).',
      );
    }
    await upsertOwner(tx, { passwordHash, totpSecretEnc });
    const revokedDevices = input.reset ? await revokeAllDevices(tx, new Date(now())) : 0;
    await writeAudit(tx, {
      actorDeviceId: null,
      action: exists ? 'owner.reset' : 'owner.created',
      target: 'owner',
    });
    return { revokedDevices };
  });
}
