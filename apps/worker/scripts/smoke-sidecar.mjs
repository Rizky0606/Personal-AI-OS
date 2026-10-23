// Uji asap untuk .exe sidecar: jalankan, baca port dari stdout, hello + permintaan lewat WebSocket lokal,
// lalu tutup stdin (seperti induk yang keluar) dan pastikan proses berhenti sendiri.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const exe = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../desktop/src-tauri/binaries/aios-worker-x86_64-pc-windows-msvc.exe',
);
const token = 'token-smoke-1234567890-abcdef';
const dataDir = mkdtempSync(join(tmpdir(), 'aios-smoke-'));
const fail = (message) => {
  console.error(`GAGAL: ${message}`);
  process.exit(1);
};

const child = spawn(exe, [], {
  env: { ...process.env, AIOS_WORKER_TOKEN: token, AIOS_WORKER_DATA_DIR: dataDir },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const exited = new Promise((r) => child.once('exit', (code) => r(code)));
const lines = createInterface({ input: child.stdout });
const timeout = setTimeout(() => fail('timeout'), 15000);

const first = await new Promise((resolveLine) => lines.once('line', resolveLine));
const listening = JSON.parse(first);
if (listening.event !== 'listening' || !(listening.port > 0))
  fail(`baris pertama tak terduga: ${first}`);

const ws = new WebSocket(`ws://127.0.0.1:${listening.port}`);
await new Promise((r, j) => (ws.once('open', r), ws.once('error', j)));
const inbox = [];
ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
ws.send(JSON.stringify({ type: 'hello', token }));
await new Promise((r) => setTimeout(r, 300));
if (!inbox.some((m) => m.type === 'ready')) fail('tidak menerima ready');
ws.send(JSON.stringify({ id: '1', method: 'status.get' }));
await new Promise((r) => setTimeout(r, 300));
const status = inbox.find((m) => m.id === '1');
if (!status?.ok || status.result.gateway !== 'offline')
  fail(`status.get: ${JSON.stringify(status)}`);

child.stdin.end();
const code = await Promise.race([
  exited,
  new Promise((r) => setTimeout(() => r('masih-hidup'), 8000)),
]);
if (code === 'masih-hidup') {
  child.kill();
  fail('proses tidak berhenti setelah stdin ditutup');
}
clearTimeout(timeout);
rmSync(dataDir, { recursive: true, force: true });
console.log(`OK: port ${listening.port}, berhenti dengan kode ${code} setelah stdin ditutup`);
