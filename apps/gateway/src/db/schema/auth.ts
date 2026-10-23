import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Akun pemilik (SECURITY_OPS.md: satu akun, tanpa pendaftaran publik). Bukan bagian "Model data inti"
 * di API_CONTRACT.md karena tidak diekspos lewat API. Hanya boleh ada satu baris.
 */
export const ownerAccount = pgTable(
  'owner_account',
  {
    id: text('id').primaryKey().default('owner'),
    /** Hash argon2id (format PHC). */
    passwordHash: text('password_hash').notNull(),
    /** Secret TOTP terenkripsi AES-256-GCM (iv.tag.ciphertext, base64url). */
    totpSecretEnc: text('totp_secret_enc').notNull(),
    /** Time-step TOTP terakhir yang dipakai; mencegah kode yang sama dipakai dua kali. */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check('owner_account_singleton', sql`${t.id} = 'owner'`)],
);
