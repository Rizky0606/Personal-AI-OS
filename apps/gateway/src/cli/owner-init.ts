/**
 * Membuat (atau mengganti) akun pemilik: password argon2id + TOTP.
 *
 *   pnpm --filter gateway owner:init            # interaktif (password tersembunyi, kode TOTP dikonfirmasi)
 *   pnpm --filter gateway owner:init --reset    # ganti akun; semua perangkat dicabut
 *   echo "password-panjang" | node dist/cli/owner-init.js    # tanpa TTY: password dari stdin
 *
 * Di VPS: docker compose exec -it gateway node dist/cli/owner-init.js
 */
import { createInterface } from 'node:readline/promises';
import QRCode from 'qrcode';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { AppError } from '../errors.js';
import { saveOwner } from '../modules/auth/owner.js';
import { MIN_PASSWORD_LENGTH } from '../modules/auth/password.js';
import { deriveAuthKeys } from '../modules/auth/secrets.js';
import { generateTotpSecret, matchTotp, otpauthUri } from '../modules/auth/totp.js';

const ISSUER = 'Personal AI OS';
const ACCOUNT = 'owner';

/** Membaca satu baris dari terminal tanpa menampilkan ketikan. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdout.write('\n');
          reject(new Error('dibatalkan'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

async function readLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function showEnrollment(secret: string): Promise<void> {
  const uri = otpauthUri(secret, ACCOUNT, ISSUER);
  console.log(
    '\nPindai QR ini dengan aplikasi autentikator (Google Authenticator, Aegis, 1Password, dll.):\n',
  );
  console.log(await QRCode.toString(uri, { type: 'utf8', errorCorrectionLevel: 'M' }));
  console.log(`Secret (base32): ${secret}`);
  console.log(`URI: ${uri}\n`);
  console.log('Simpan secret ini di tempat aman. Ini tidak akan ditampilkan lagi.');
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const interactive = process.stdin.isTTY;

  let password: string;
  if (interactive) {
    password = await readHidden(`Password pemilik (minimal ${MIN_PASSWORD_LENGTH} karakter): `);
    if (password !== (await readHidden('Ulangi password: '))) {
      throw new AppError(400, 'password_mismatch', 'Kedua password tidak sama.');
    }
  } else {
    password = await readPasswordFromStdin();
  }

  const config = loadConfig();
  const keys = deriveAuthKeys(config.AUTH_SECRET);
  const secret = generateTotpSecret();
  await showEnrollment(secret);

  if (interactive) {
    // Konfirmasi sebelum menyimpan, agar salah pindai tidak mengunci pemilik di luar.
    let confirmed = false;
    for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
      const code = await readLine('Masukkan kode 6 digit dari aplikasi untuk konfirmasi: ');
      confirmed = matchTotp(secret, code, Date.now()) !== null;
      if (!confirmed) console.log('Kode salah.');
    }
    if (!confirmed)
      throw new AppError(
        400,
        'totp_not_confirmed',
        'Kode TOTP tidak terkonfirmasi. Tidak ada yang disimpan.',
      );
  }

  const handle = createDb(config.DATABASE_URL);
  try {
    const { revokedDevices } = await saveOwner(handle.db, keys, {
      password,
      totpSecret: secret,
      reset,
    });
    console.log(
      reset ? `Akun pemilik diganti. ${revokedDevices} perangkat dicabut.` : 'Akun pemilik dibuat.',
    );
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  const message =
    err instanceof AppError
      ? `${err.message} (${err.code})`
      : err instanceof Error
        ? err.message
        : 'Kesalahan tak dikenal.';
  console.error(`owner:init gagal: ${message}`);
  process.exitCode = 1;
});
