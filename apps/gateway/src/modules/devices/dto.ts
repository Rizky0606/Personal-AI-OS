import type { DeviceSchema, Scope } from '@aios/contracts';
import type { z } from 'zod';
import type { DeviceRow } from '../auth/repo.js';

export type DeviceDto = z.infer<typeof DeviceSchema>;

/** Bentuk publik perangkat. token_hash, push_token, dan kolom pencabutan tidak pernah keluar. */
export function toDeviceDto(row: DeviceRow): DeviceDto {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    scopes: row.scopes as Scope[],
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
