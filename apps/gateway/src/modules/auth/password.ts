import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * Argon2id dengan parameter minimum OWASP (m=19 MiB, t=2, p=1). Hasilnya string PHC
 * ($argon2id$...) yang memuat parameter dan salt, jadi parameter bisa dinaikkan kemudian.
 */
// Algorithm adalah const enum ambient, jadi nilainya (Argon2id = 2) ditulis langsung.
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/** false untuk password salah maupun hash rusak; tidak pernah melempar. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Hash palsu untuk menyamakan waktu respons saat akun pemilik belum ada, supaya penyerang
 * tidak bisa membedakan "belum ada akun" dari "password salah" lewat latensi.
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash;
}
