/**
 * Mengirim notifikasi uji FCM ke perangkat Android yang sudah mendaftarkan push token:
 *   pnpm --filter gateway push:test            # semua perangkat Android aktif
 *   pnpm --filter gateway push:test <deviceId> # satu perangkat
 * Di VPS: docker compose exec gateway node dist/cli/push-test.js [deviceId]
 * Isi notifikasi hanya judul "Tes notifikasi Personal AI OS" dan data { type: "test" }.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { ConfigError, loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { devices } from '../db/schema/index.js';
import { createEventHub } from '../modules/runs/hub.js';
import { FcmConfigError, createFcmClient, loadServiceAccount } from '../modules/push/fcm.js';
import { createPushService } from '../modules/push/service.js';

const REASONS = {
  unregistered: 'token sudah mati (dihapus dari perangkat; aplikasi perlu mendaftarkan token baru)',
  invalid: 'FCM menolak pesan atau token',
  auth: 'kredensial service account ditolak FCM (periksa project dan file)',
  unavailable: 'FCM tidak tersedia, coba lagi',
} as const;

async function main(): Promise<number> {
  const config = loadConfig();
  if (!config.FCM_SERVICE_ACCOUNT_FILE) {
    console.error('push:test gagal: FCM_SERVICE_ACCOUNT_FILE belum diisi.');
    return 1;
  }
  const deviceId = process.argv[2];
  const { db, close } = createDb(config.DATABASE_URL);
  try {
    const android = await db
      .select({ id: devices.id, name: devices.name, pushToken: devices.pushToken })
      .from(devices)
      .where(and(eq(devices.kind, 'android'), isNull(devices.revokedAt)));
    const withToken = android.filter((d) => d.pushToken);
    if (android.length === 0) {
      console.error('Belum ada perangkat Android yang login.');
      return 1;
    }
    for (const d of android.filter((x) => !x.pushToken)) {
      console.log(`- ${d.name} (${d.id}): belum mendaftarkan push token, dilewati`);
    }
    if (withToken.length === 0) return 1;

    const push = createPushService({
      db,
      hub: createEventHub(),
      fcm: createFcmClient({ account: loadServiceAccount(config.FCM_SERVICE_ACCOUNT_FILE) }),
    });
    const results = await push.sendTest(deviceId ? { deviceId } : {});
    if (results.length === 0) {
      console.error(
        deviceId
          ? `Perangkat ${deviceId} tidak ditemukan atau tanpa push token.`
          : 'Tidak ada tujuan.',
      );
      return 1;
    }
    for (const r of results) {
      console.log(
        r.result.ok
          ? `- ${r.name} (${r.deviceId}): terkirim ke FCM`
          : `- ${r.name} (${r.deviceId}): GAGAL, ${REASONS[r.result.reason]}`,
      );
    }
    return results.every((r) => r.result.ok) ? 0 : 1;
  } finally {
    await close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(
      err instanceof ConfigError || err instanceof FcmConfigError
        ? err.message
        : 'push:test gagal.',
    );
    process.exitCode = 1;
  },
);
