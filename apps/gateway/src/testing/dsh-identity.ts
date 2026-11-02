import { chmod, chown } from 'node:fs/promises';

/** Pengguna non-root untuk tes dsh bila tes dijalankan sebagai root (CI Docker, container): `nobody`. */
export const DSH_TEST_ID = 65534;

/**
 * Identitas DSH_UID/DSH_GID untuk tes. Pemeriksaan keamanan produksi (`createDshEngine` menolak gateway root tanpa
 * DSH_UID) TIDAK dilonggarkan: saat tes berjalan sebagai root, tes mengisi identitas non-root seperti yang
 * diwajibkan RUNBOOK_DSH.md; selain root, dibiarkan kosong.
 */
export function dshTestIdentity(gatewayUid: number | undefined = process.getuid?.()): {
  DSH_UID: number | undefined;
  DSH_GID: number | undefined;
} {
  return gatewayUid === 0
    ? { DSH_UID: DSH_TEST_ID, DSH_GID: DSH_TEST_ID }
    : { DSH_UID: undefined, DSH_GID: undefined };
}

/**
 * Menyiapkan akar folder kerja seperti RUNBOOK_DSH.md saat dsh berjalan sebagai pengguna lain: milik grup dsh,
 * mode 2770 (setgid), supaya folder per run yang dibuat gateway bisa dimasuki proses dsh. Tanpa efek bila bukan root.
 */
export async function prepareDshRoot(root: string, gatewayUid = process.getuid?.()): Promise<void> {
  if (gatewayUid !== 0) return;
  await chown(root, 0, DSH_TEST_ID);
  await chmod(root, 0o2770);
}
