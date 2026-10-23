import { describe, expect, it } from 'vitest';
import type { PtyProcess, PtySpawnOptions } from './pty.js';
import { TerminalError, TerminalService, defaultShell, shellEnv } from './service.js';

const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const RUN = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';

interface Fake extends PtyProcess {
  options: PtySpawnOptions;
  written: string[];
  size: [number, number];
  killed: boolean;
}

function setup(over: Partial<ConstructorParameters<typeof TerminalService>[0]> = {}) {
  const spawned: Fake[] = [];
  const data: [string, string][] = [];
  const exits: [string, number | null][] = [];
  const service = new TerminalService({
    resolveCwd: (t) => Promise.resolve(t.runId ? `C:\\wt\\${t.runId}` : 'C:\\proyek'),
    spawn: (options) => {
      const fake: Fake = {
        options,
        written: [],
        size: [options.cols, options.rows],
        killed: false,
        write: (d) => void fake.written.push(d),
        resize: (c, r) => void (fake.size = [c, r]),
        kill: () => void (fake.killed = true),
      };
      spawned.push(fake);
      return fake;
    },
    env: { PATH: 'C:\\bin', AIOS_WORKER_TOKEN: 'rahasia', aios_lain: 'x', HOME: 'C:\\u' },
    platform: 'win32',
    onData: (id, d) => void data.push([id, d]),
    onExit: (id, code) => void exits.push([id, code]),
    ...over,
  });
  return { service, spawned, data, exits };
}

describe('TerminalService', () => {
  it('membuka PowerShell di folder project dengan ukuran awal; lingkungan tanpa variabel AIOS_*', async () => {
    const { service, spawned } = setup();

    const info = await service.open({ projectId: PROJECT }, { cols: 100, rows: 30 });

    expect(info).toMatchObject({
      cwd: 'C:\\proyek',
      shell: 'powershell.exe',
      replay: '',
      exitCode: null,
    });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.options).toMatchObject({
      command: 'powershell.exe',
      args: ['-NoLogo'],
      cols: 100,
      rows: 30,
    });
    const env = spawned[0]?.options.env ?? {};
    expect(env.PATH).toBe('C:\\bin');
    expect(env.TERM).toBe('xterm-256color');
    expect(Object.keys(env).some((k) => k.toLowerCase().startsWith('aios_'))).toBe(false);
  });

  it('satu terminal per project: membuka lagi memakai yang sama, mengubah ukuran, dan mengirim riwayat keluaran', async () => {
    const { service, spawned, data } = setup();
    const first = await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });
    spawned[0]!.options.onData('PS C:\\proyek> ');

    const again = await service.open({ projectId: PROJECT }, { cols: 120, rows: 40 });

    expect(again.id).toBe(first.id);
    expect(again.replay).toBe('PS C:\\proyek> ');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.size).toEqual([120, 40]);
    expect(data).toEqual([[first.id, 'PS C:\\proyek> ']]);
  });

  it('terminal run memakai cwd worktree dan terpisah dari terminal project', async () => {
    const { service } = setup();
    const project = await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });
    const run = await service.open({ projectId: PROJECT, runId: RUN }, { cols: 80, rows: 24 });

    expect(run.id).not.toBe(project.id);
    expect(run.cwd).toBe(`C:\\wt\\${RUN}`);
  });

  it('write dan resize diteruskan; ID tidak dikenal ditolak', async () => {
    const { service, spawned } = setup();
    const { id } = await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });

    service.write(id, 'dir\r');
    service.resize(id, 90, 20);

    expect(spawned[0]?.written).toEqual(['dir\r']);
    expect(spawned[0]?.size).toEqual([90, 20]);
    expect(() => service.write('term-tidak-ada', 'x')).toThrow(TerminalError);
  });

  it('shell berhenti: kode keluar dilaporkan; membuka lagi menjalankan shell baru', async () => {
    const { service, spawned, exits } = setup();
    const first = await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });

    spawned[0]!.options.onExit(0);
    expect(exits).toEqual([[first.id, 0]]);
    service.write(first.id, 'abaikan');
    expect(spawned[0]?.written).toEqual([]);

    const second = await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });
    expect(second.id).not.toBe(first.id);
    expect(spawned).toHaveLength(2);
  });

  it('close mematikan shell; closeByRun hanya menutup terminal run itu; closeAll menutup semua', async () => {
    const { service, spawned } = setup();
    const project = await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });
    await service.open({ projectId: PROJECT, runId: RUN }, { cols: 80, rows: 24 });

    service.closeByRun(RUN);
    expect(spawned.map((s) => s.killed)).toEqual([false, true]);
    expect(service.count).toBe(1);

    service.close(project.id);
    expect(spawned[0]?.killed).toBe(true);
    await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });
    service.closeAll();
    expect(service.count).toBe(0);
  });

  it('folder tidak bisa dipakai atau spawn gagal: terminal_unavailable dengan pesan', async () => {
    const noFolder = setup({
      resolveCwd: () => Promise.reject(new Error('Project belum terikat.')),
    });
    await expect(
      noFolder.service.open({ projectId: PROJECT }, { cols: 80, rows: 24 }),
    ).rejects.toMatchObject({
      code: 'terminal_unavailable',
      message: 'Project belum terikat.',
    });

    const noPty = setup({
      spawn: () => {
        throw new Error('PTY hanya tersedia di worker hasil kompilasi Bun.');
      },
    });
    await expect(
      noPty.service.open({ projectId: PROJECT }, { cols: 80, rows: 24 }),
    ).rejects.toThrow('kompilasi Bun');
    expect(noPty.service.count).toBe(0);
  });

  it('riwayat dibatasi 64 KB dan jumlah terminal dibatasi', async () => {
    const { service, spawned } = setup();
    const { id } = await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });
    spawned[0]!.options.onData('x'.repeat(70 * 1024));
    spawned[0]!.options.onData('AKHIR');
    const again = await service.open({ projectId: PROJECT }, { cols: 80, rows: 24 });
    expect(again.id).toBe(id);
    expect(again.replay.length).toBe(64 * 1024);
    expect(again.replay.endsWith('AKHIR')).toBe(true);

    for (let i = 0; i < 7; i++) await service.open({ projectId: `p${i}` }, { cols: 80, rows: 24 });
    await expect(service.open({ projectId: 'p-terakhir' }, { cols: 80, rows: 24 })).rejects.toThrow(
      'Maksimal 8',
    );
  });
});

describe('shellEnv dan defaultShell', () => {
  it('membuang AIOS_* (tanpa memedulikan huruf besar) dan memasang TERM', () => {
    expect(shellEnv({ A: '1', AIOS_X: '2', aios_y: '3', B: undefined })).toEqual({
      A: '1',
      TERM: 'xterm-256color',
    });
  });

  it('Windows: PowerShell; lainnya: $SHELL atau bash', () => {
    expect(defaultShell('win32', {})).toEqual({ command: 'powershell.exe', args: ['-NoLogo'] });
    expect(defaultShell('linux', { SHELL: '/usr/bin/zsh' })).toEqual({
      command: '/usr/bin/zsh',
      args: [],
    });
    expect(defaultShell('linux', {})).toEqual({ command: '/bin/bash', args: [] });
  });
});
