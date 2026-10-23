import type { Database } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { writeAudit } from '../audit/repo.js';
import { listActiveDevices, revokeDevice, setPushToken } from '../auth/repo.js';
import { toDeviceDto, type DeviceDto } from './dto.js';

export interface DevicesService {
  list(): Promise<DeviceDto[]>;
  revoke(actorDeviceId: string, id: string): Promise<void>;
  setPushToken(actorDeviceId: string, id: string, pushToken: string): Promise<void>;
}

const notFound = () => new AppError(404, 'device_not_found', 'Perangkat tidak ditemukan.');

export function createDevicesService(deps: { db: Database; now?: () => number }): DevicesService {
  const { db, now = Date.now } = deps;

  return {
    async list() {
      return (await listActiveDevices(db)).map(toDeviceDto);
    },

    async revoke(actorDeviceId, id) {
      if (!(await revokeDevice(db, id, new Date(now())))) throw notFound();
      await writeAudit(db, { actorDeviceId, action: 'device.revoked', target: `device:${id}` });
    },

    async setPushToken(actorDeviceId, id, pushToken) {
      if (!(await setPushToken(db, id, pushToken))) throw notFound();
      // Nilai token tidak dicatat di audit, hanya fakta bahwa token diganti.
      await writeAudit(db, {
        actorDeviceId,
        action: 'device.push_token_set',
        target: `device:${id}`,
      });
    },
  };
}
