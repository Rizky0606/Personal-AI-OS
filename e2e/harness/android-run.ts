import { spawn } from 'node:child_process';
import path from 'node:path';
import { startStack } from './stack.js';

/**
 * Menyalakan stack E2E (gateway nyata + layanan palsu), lalu menjalankan tes instrumentasi Compose di emulator/
 * perangkat yang tersambung lewat Gradle. Emulator mengakses gateway di host lewat 10.0.2.2.
 *   pnpm --filter @aios/e2e android          # butuh emulator berjalan (adb devices) dan JDK 17+
 */
const root = path.resolve(import.meta.dirname, '../..');
const stack = await startStack();
try {
  const config = (await (await fetch(`${stack.controlUrl}/config`)).json()) as {
    gatewayUrl: string;
    password: string;
    hermesAnswer: string;
  };
  const { code } = (await (await fetch(`${stack.controlUrl}/totp`)).json()) as { code: string };
  const gatewayUrl = config.gatewayUrl.replace('127.0.0.1', '10.0.2.2');
  const gradle = path.join(
    root,
    'apps/android',
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
  );
  const arg = (k: string, v: string) => `-Pandroid.testInstrumentationRunnerArguments.${k}=${v}`;
  // Asinkron: gateway berjalan di proses ini, jadi event loop tidak boleh diblokir selama Gradle berjalan.
  const child = spawn(
    gradle,
    [
      'connectedDebugAndroidTest',
      // Tanpa alamat tertanam: tes mengetik alamat gateway E2E di layar login.
      '-PaiosGatewayUrl=',
      arg('gatewayUrl', gatewayUrl),
      arg('password', config.password),
      arg('totp', code),
      // Satu kata (tanpa spasi) agar aman lewat shell; muncul di jawaban Hermes palsu.
      arg('hermesAnswer', 'Hermes'),
    ],
    { cwd: path.join(root, 'apps/android'), stdio: 'inherit', shell: process.platform === 'win32' },
  );
  process.exitCode = await new Promise<number>((resolve) => {
    child.once('exit', (code) => resolve(code ?? 1));
    child.once('error', () => resolve(1));
  });
} finally {
  await stack.stop();
}
