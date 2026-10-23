import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { devices, ownerAccount } from '../../db/schema/index.js';

export type DeviceRow = typeof devices.$inferSelect;
export type OwnerRow = typeof ownerAccount.$inferSelect;

/* Akun pemilik */

export async function getOwner(db: Database): Promise<OwnerRow | undefined> {
  const [row] = await db.select().from(ownerAccount).limit(1);
  return row;
}

export async function ownerExists(db: Pick<Database, 'select'>): Promise<boolean> {
  const [row] = await db.select({ id: ownerAccount.id }).from(ownerAccount).limit(1);
  return row !== undefined;
}

export async function upsertOwner(
  db: Pick<Database, 'insert'>,
  values: { passwordHash: string; totpSecretEnc: string },
): Promise<void> {
  await db
    .insert(ownerAccount)
    .values({ ...values, totpLastStep: 0 })
    .onConflictDoUpdate({
      target: ownerAccount.id,
      set: { ...values, totpLastStep: 0, updatedAt: new Date() },
    });
}

/** Mencatat time-step TOTP yang dipakai. false bila step ini (atau yang lebih baru) sudah pernah dipakai. */
export async function consumeTotpStep(db: Database, step: number): Promise<boolean> {
  const rows = await db
    .update(ownerAccount)
    .set({ totpLastStep: step, updatedAt: new Date() })
    .where(and(eq(ownerAccount.id, 'owner'), lt(ownerAccount.totpLastStep, step)))
    .returning({ id: ownerAccount.id });
  return rows.length === 1;
}

/* Perangkat */

export async function insertDevice(
  db: Database,
  values: typeof devices.$inferInsert,
): Promise<DeviceRow> {
  const [row] = await db.insert(devices).values(values).returning();
  if (!row) throw new Error('insert device gagal');
  return row;
}

export async function findDevice(db: Database, id: string): Promise<DeviceRow | undefined> {
  const [row] = await db.select().from(devices).where(eq(devices.id, id));
  return row;
}

export async function listActiveDevices(db: Database): Promise<DeviceRow[]> {
  return db.select().from(devices).where(isNull(devices.revokedAt)).orderBy(devices.id);
}

/**
 * Mengganti hash refresh token hanya jika hash lama masih cocok dan perangkat belum dicabut.
 * Dua refresh bersamaan dengan token yang sama: hanya satu yang menang.
 */
export async function rotateRefreshHash(
  db: Database,
  args: { id: string; oldHash: string; newHash: string; expiresAt: Date },
): Promise<DeviceRow | undefined> {
  const [row] = await db
    .update(devices)
    .set({ tokenHash: args.newHash, refreshExpiresAt: args.expiresAt })
    .where(
      and(eq(devices.id, args.id), eq(devices.tokenHash, args.oldHash), isNull(devices.revokedAt)),
    )
    .returning();
  return row;
}

/** true bila perangkat aktif dan sekarang dicabut. Hash dikosongkan agar tidak ada token yang cocok. */
export async function revokeDevice(
  db: Pick<Database, 'update'>,
  id: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(devices)
    .set({ revokedAt: at, tokenHash: '' })
    .where(and(eq(devices.id, id), isNull(devices.revokedAt)))
    .returning({ id: devices.id });
  return rows.length === 1;
}

export async function revokeAllDevices(db: Pick<Database, 'update'>, at: Date): Promise<number> {
  const rows = await db
    .update(devices)
    .set({ revokedAt: at, tokenHash: '' })
    .where(isNull(devices.revokedAt))
    .returning({ id: devices.id });
  return rows.length;
}

/** Memperbarui last_seen_at paling sering sekali per `minIntervalMs` agar tidak menulis di tiap request. */
export async function touchDevice(
  db: Database,
  id: string,
  at: Date,
  minIntervalMs = 60_000,
): Promise<void> {
  const threshold = new Date(at.getTime() - minIntervalMs);
  await db
    .update(devices)
    .set({ lastSeenAt: at })
    .where(
      and(eq(devices.id, id), or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, threshold))),
    );
}

export async function setPushToken(db: Database, id: string, pushToken: string): Promise<boolean> {
  const rows = await db
    .update(devices)
    .set({ pushToken })
    .where(and(eq(devices.id, id), isNull(devices.revokedAt)))
    .returning({ id: devices.id });
  return rows.length === 1;
}
