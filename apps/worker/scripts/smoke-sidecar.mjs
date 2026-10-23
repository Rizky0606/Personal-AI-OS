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

// Terminal PTY sungguhan di .exe: buka shell di folder project, ketik perintah, keluarannya kembali sebagai push.
const projectDir = mkdtempSync(join(tmpdir(), 'aios-smoke-proj-'));
const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const call = async (id, method, params) => {
  ws.send(JSON.stringify({ id, method, params }));
  for (let i = 0; i < 100; i++) {
    const found = inbox.find((m) => m.id === id);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fail(`tidak ada jawaban untuk ${method}`);
};
const added = await call('f', 'folders.add', { path: projectDir });
if (!added.ok) fail(`folders.add: ${JSON.stringify(added)}`);
const bound = await call('b', 'project.bind', { projectId: PROJECT, path: projectDir });
if (!bound.ok) fail(`project.bind: ${JSON.stringify(bound)}`);
const opened = await call('t', 'terminal.open', { projectId: PROJECT, cols: 100, rows: 30 });
if (!opened.ok) fail(`terminal.open: ${JSON.stringify(opened)}`);
const terminalId = opened.result.id;
await call('w', 'terminal.write', {
  terminalId,
  data: `echo halo-dari-pty${String.fromCharCode(13)}`,
});
let output = '';
// Muncul dua kali: gema ketikan dan hasil perintah.
for (let i = 0; i < 100 && output.split('halo-dari-pty').length < 3; i++) {
  await new Promise((r) => setTimeout(r, 100));
  output = inbox
    .filter((m) => m.push === 'terminal.data' && m.terminalId === terminalId)
    .map((m) => m.data)
    .join('');
}
if (!output.includes('halo-dari-pty'))
  fail(`keluaran PTY tidak muncul: ${JSON.stringify(output.slice(-200))}`);
if (/AIOS_WORKER_TOKEN/.test(output)) fail('token worker bocor ke shell');
await call('x', 'terminal.close', { terminalId });

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
// Folder project dibersihkan setelah sidecar (dan shell-nya) berhenti; gagal menghapus bukan kegagalan uji.
for (const dir of [dataDir, projectDir]) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  } catch {
    console.error(`peringatan: ${dir} belum bisa dihapus`);
  }
}
console.log(`OK: port ${listening.port}, berhenti dengan kode ${code} setelah stdin ditutup`);
