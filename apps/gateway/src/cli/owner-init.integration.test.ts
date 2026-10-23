import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AUTH_SECRET, createAuthEnv } from '../testing/auth-env.js';
import { createTestDatabase, type TestDatabase } from '../testing/db.js';
import { verifyPassword } from '../modules/auth/password.js';
import { getOwner } from '../modules/auth/repo.js';
import { decryptSecret, deriveAuthKeys } from '../modules/auth/secrets.js';
import { createAuthService } from '../modules/auth/service.js';
import { timeStep, totpCode } from '../modules/auth/totp.js';

const GATEWAY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PASSWORD = 'password-pemilik-yang-panjang';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase(inject('testDatabaseUrl'));
});
afterAll(async () => {
  await database.drop();
});

/** Menjalankan CLI sebagai proses sungguhan; stdin berupa pipa sehingga password dibaca dari stdin. */
function runCli(
  args: string[],
  stdin: string,
  env: Record<string, string | undefined> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/owner-init.ts', ...args], {
      cwd: GATEWAY_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: database.url,
        AUTH_SECRET,
        CI: '',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

describe('pnpm --filter gateway owner:init', () => {
  it('membuat akun: menampilkan QR, secret, dan URI; password argon2id dan secret terenkripsi di DB', async () => {
    const res = await runCli([], `${PASSWORD}\n`);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('Akun pemilik dibuat.');
    expect(res.stdout).toMatch(/[█▀▄]/); // QR berupa blok Unicode
    expect(res.stdout).toContain('otpauth://totp/Personal%20AI%20OS:owner');
    const secret = /Secret \(base32\): ([A-Z2-7]{32})/.exec(res.stdout)?.[1];
    expect(secret).toBeDefined();
    expect(res.stdout).not.toContain(PASSWORD);
    expect(res.stderr).not.toContain(PASSWORD);

    const owner = await getOwner(database.handle.db);
    expect(owner?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(owner?.passwordHash ?? '', PASSWORD)).toBe(true);
    expect(owner?.totpSecretEnc).not.toContain(secret ?? '??');
    expect(decryptSecret(deriveAuthKeys(AUTH_SECRET).totp, owner?.totpSecretEnc ?? '')).toBe(
      secret,
    );

    // Secret yang dicetak benar-benar bisa dipakai untuk login.
    const auth = createAuthService({ db: database.handle.db, keys: deriveAuthKeys(AUTH_SECRET) });
    const login = await auth.login(
      {
        password: PASSWORD,
        totp: totpCode(secret ?? '', timeStep(Date.now())),
        device: { name: 'uji CLI', kind: 'desktop' },
      },
      { ip: '127.0.0.1' },
    );
    expect(login.device.name).toBe('uji CLI');
  });

  it('menolak akun kedua tanpa --reset dan tidak mengubah apa pun', async () => {
    const before = await getOwner(database.handle.db);
    const res = await runCli([], 'password-lain-yang-panjang\n');
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('owner_exists');
    expect((await getOwner(database.handle.db))?.passwordHash).toBe(before?.passwordHash);
  });

  it('--reset mengganti akun dan mencabut semua perangkat', async () => {
    const res = await runCli(['--reset'], 'password-baru-yang-panjang\n');
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/Akun pemilik diganti\. 1 perangkat dicabut\./);
    const owner = await getOwner(database.handle.db);
    expect(await verifyPassword(owner?.passwordHash ?? '', 'password-baru-yang-panjang')).toBe(
      true,
    );
    expect(await verifyPassword(owner?.passwordHash ?? '', PASSWORD)).toBe(false);
  });

  it('password terlalu pendek: gagal dengan kode weak_password', async () => {
    const res = await runCli(['--reset'], 'pendek\n');
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('weak_password');
  });

  it('AUTH_SECRET hilang: gagal cepat menyebut variabelnya', async () => {
    const res = await runCli([], `${PASSWORD}\n`, { AUTH_SECRET: '' });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('AUTH_SECRET');
  });

  it('akun hasil CLI dipakai app yang sama (alur lengkap lewat HTTP)', async () => {
    const env = await createAuthEnv(inject('testDatabaseUrl'));
    try {
      expect((await env.loginOk()).device.kind).toBe('desktop');
    } finally {
      await env.close();
    }
  });
});
