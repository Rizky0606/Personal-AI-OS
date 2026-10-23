import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ProcessManager } from './manager.js';

const node = process.execPath;
const cwd = tmpdir();
const sleepScript = (ms: number) => `setTimeout(() => {}, ${ms})`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await sleep(10);
  }
}

describe('ProcessManager.run', () => {
  it('menjalankan perintah tanpa shell dan mengumpulkan stdout, stderr, dan kode keluar', async () => {
    const manager = new ProcessManager();

    const result = await manager.run(
      node,
      ['-e', 'console.log("halo"); console.error("peringatan"); process.exit(3)'],
      { cwd },
    );

    expect(result).toMatchObject({ code: 3, timedOut: false, truncated: false });
    expect(result.stdout.trim()).toBe('halo');
    expect(result.stderr.trim()).toBe('peringatan');
  });

  it('argumen berisi metakarakter shell dianggap teks biasa (tidak ada injeksi)', async () => {
    const manager = new ProcessManager();

    const result = await manager.run(
      node,
      ['-e', 'console.log(process.argv[1])', '&& echo bocor ; rm -rf /'],
      { cwd },
    );

    expect(result.stdout.trim()).toBe('&& echo bocor ; rm -rf /');
  });

  it('stdin diteruskan', async () => {
    const result = await new ProcessManager().run(
      node,
      ['-e', 'process.stdin.on("data", (d) => process.stdout.write(String(d).toUpperCase()))'],
      { cwd, input: 'abc' },
    );

    expect(result.stdout).toBe('ABC');
  });

  it('melewati batas waktu: proses dimatikan dan timedOut true', async () => {
    const manager = new ProcessManager();

    const started = Date.now();
    const result = await manager.run(node, ['-e', sleepScript(30_000)], { cwd, timeoutMs: 200 });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(manager.running).toBe(0);
  });

  it('keluaran berlebih dipotong dan ditandai truncated', async () => {
    const result = await new ProcessManager().run(
      node,
      ['-e', 'process.stdout.write("x".repeat(50000))'],
      { cwd, maxOutputBytes: 1000 },
    );

    expect(result.stdout).toHaveLength(1000);
    expect(result.truncated).toBe(true);
  });

  it('program yang tidak ada menghasilkan spawnError, bukan melempar', async () => {
    const result = await new ProcessManager().run('program-yang-tidak-ada-aios', [], { cwd });

    expect(result.spawnError).toBeTruthy();
    expect(result.code).toBeNull();
  });

  it('nama perintah dengan baris baru atau NUL ditolak', async () => {
    const manager = new ProcessManager();

    expect((await manager.run('node\n--eval', [], { cwd })).spawnError).toBeTruthy();
    expect((await manager.run('', [], { cwd })).spawnError).toBeTruthy();
  });

  it('checkCwd dipanggil dan penolakannya menghentikan proses sebelum dimulai', async () => {
    const manager = new ProcessManager({
      checkCwd: (dir) => Promise.reject(new Error(`ditolak: ${dir}`)),
    });

    await expect(manager.run(node, ['-e', '0'], { cwd })).rejects.toThrow('ditolak');
    expect(manager.running).toBe(0);
  });
});

describe('ProcessManager: batas dan pembersihan', () => {
  it('membatasi proses bersamaan; sisanya antre dan tetap selesai semua', async () => {
    const manager = new ProcessManager({ maxConcurrent: 2 });
    let peak = 0;
    const watcher = setInterval(() => {
      peak = Math.max(peak, manager.running);
    }, 5);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => manager.run(node, ['-e', sleepScript(150)], { cwd })),
    );
    clearInterval(watcher);

    expect(results.every((r) => r.code === 0)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
    expect(manager.running).toBe(0);
  });

  it('killRun mematikan hanya proses milik run itu', async () => {
    const manager = new ProcessManager();
    const mine = manager.run(node, ['-e', sleepScript(30_000)], {
      cwd,
      runId: 'run-a',
      timeoutMs: 60_000,
    });
    const other = manager.run(node, ['-e', sleepScript(600)], { cwd, runId: 'run-b' });
    await until(() => manager.running === 2);
    expect(manager.activeRunIds().sort()).toEqual(['run-a', 'run-b']);

    await manager.killRun('run-a');

    const [killed, survivor] = await Promise.all([mine, other]);
    expect(killed.code).not.toBe(0);
    expect(survivor.code).toBe(0);
  });

  it('killRun mematikan juga proses turunan (cucu)', async () => {
    const manager = new ProcessManager();
    // Anak menjalankan cucu yang hidup lama lalu menulis pid cucu.
    const script = `
      const { spawn } = require('node:child_process');
      const grandchild = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore' });
      console.log(grandchild.pid);
      setTimeout(() => {}, 30000);`;
    const job = manager.run(node, ['-e', script], { cwd, runId: 'run-tree', timeoutMs: 60_000 });
    await until(() => manager.running === 1);
    await sleep(500);

    await manager.killRun('run-tree');
    const result = await job;
    const grandchildPid = Number(result.stdout.trim());

    expect(Number.isInteger(grandchildPid)).toBe(true);
    await until(() => !isAlive(grandchildPid), 5000);
  });

  it('killAll mematikan semua, mengosongkan antrean, dan menolak proses baru', async () => {
    const manager = new ProcessManager({ maxConcurrent: 1 });
    const running = manager.run(node, ['-e', sleepScript(30_000)], { cwd, timeoutMs: 60_000 });
    const queued = manager.run(node, ['-e', sleepScript(30_000)], { cwd, timeoutMs: 60_000 });
    await until(() => manager.running === 1);

    await manager.killAll();

    expect((await running).code).not.toBe(0);
    expect((await queued).spawnError).toMatch(/berhenti/);
    expect((await manager.run(node, ['-e', '0'], { cwd })).spawnError).toMatch(/berhenti/);
    expect(manager.running).toBe(0);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
