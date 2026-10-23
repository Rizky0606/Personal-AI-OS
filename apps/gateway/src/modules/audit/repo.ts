import type { Database } from '../../db/client.js';
import { auditLog } from '../../db/schema/index.js';

export interface AuditEntry {
  actorDeviceId: string | null;
  /** Nama aksi bertitik, mis. `auth.login`, `device.revoked`. */
  action: string;
  /** Sasaran aksi (`device:<id>`, alamat IP). Tidak boleh berisi token, password, atau rahasia lain. */
  target: string;
}

type Executor = Pick<Database, 'insert'>;

export async function writeAudit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values(entry);
}
