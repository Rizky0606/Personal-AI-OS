import { describe, expect, it } from 'vitest';
import { buildActivity, formatElapsed, truncateTarget } from './activity';
import { newLiveRun, type LiveRun, type ToolStep } from './liveRun';

const T0 = Date.parse('2026-10-29T10:00:00Z');
const run = (over: Partial<LiveRun> = {}): LiveRun => ({
  ...newLiveRun('r1'),
  status: 'running',
  startedAt: T0,
  ...over,
});
const tool = (over: Partial<ToolStep> & { id: string }): ToolStep => ({
  name: 'bash',
  target: undefined,
  status: 'running',
  durationMs: undefined,
  startedAt: T0,
  ...over,
});

describe('formatElapsed', () => {
  /*
   * Aturan pembulatan: detik dipotong ke bawah (floor), supaya penghitung tidak pernah mendahului waktu nyata.
   * < 60 dtk: "N dtk". < 1 jam: "M mnt SS dtk" (detik 2 digit). >= 1 jam: "J j MM mnt" (menit 2 digit, detik
   * dibuang dan menit juga dipotong ke bawah). Negatif atau bukan angka dianggap 0.
   */
  it.each([
    [0, '0 dtk'],
    [999, '0 dtk'],
    [1000, '1 dtk'],
    [8000, '8 dtk'],
    [59_999, '59 dtk'],
    [60_000, '1 mnt 00 dtk'],
    [65_000, '1 mnt 05 dtk'],
    [384_000, '6 mnt 24 dtk'],
    [3_599_999, '59 mnt 59 dtk'],
    [3_600_000, '1 j 00 mnt'],
    [3_720_000, '1 j 02 mnt'],
    [3_779_999, '1 j 02 mnt'],
    [90_000_000, '25 j 00 mnt'],
    [-5000, '0 dtk'],
    [Number.NaN, '0 dtk'],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });
});

describe('truncateTarget', () => {
  it('target pendek tetap; satu baris; spasi dipadatkan', () => {
    expect(truncateTarget('npm test')).toBe('npm test');
    expect(truncateTarget('  git   status\nlanjut ')).toBe('git status');
  });

  it('perintah dan URL panjang dipotong di ujung; path panjang mempertahankan ujung (nama berkas)', () => {
    const command = `node ${'x'.repeat(100)}`;
    expect(truncateTarget(command)).toHaveLength(60);
    expect(truncateTarget(command).endsWith('…')).toBe(true);
    expect(truncateTarget(command).startsWith('node xx')).toBe(true);

    const path = `C:\\proyek\\${'sub\\'.repeat(30)}berkas.ts`;
    const cut = truncateTarget(path);
    expect(cut).toHaveLength(60);
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.endsWith('berkas.ts')).toBe(true);

    expect(truncateTarget(`https://contoh.com/${'a'.repeat(100)}`).endsWith('…')).toBe(true);
  });
});

describe('buildActivity: judul (headline)', () => {
  it('memakai reasoning.summary dari mesin bila ada, mengalahkan teks penalaran', () => {
    const a = buildActivity(
      run({ reasoningSummary: 'Membaca konfigurasi', reasoning: 'Saya akan melakukan hal lain.' }),
      T0,
    );
    expect(a.headline).toBe('Membaca konfigurasi');
  });

  it('tanpa ringkasan: kalimat pertama penalaran, tanpa markdown dan titik akhir', () => {
    expect(
      buildActivity(
        run({ reasoning: 'Saya perlu membaca `package.json` dulu. Lalu menulis tes.' }),
        T0,
      ).headline,
    ).toBe('Saya perlu membaca package.json dulu');
    expect(
      buildActivity(run({ reasoning: '**Memeriksa berkas**\n\nSaya akan membuka config.' }), T0)
        .headline,
    ).toBe('Memeriksa berkas');
    expect(buildActivity(run({ reasoning: '## Rencana\n- langkah satu' }), T0).headline).toBe(
      'Rencana',
    );
    expect(
      buildActivity(run({ reasoning: 'Lihat [dokumen](https://x.test/a) untuk detail.' }), T0)
        .headline,
    ).toBe('Lihat dokumen untuk detail');
    expect(buildActivity(run({ reasoning: '```\n```\n- Mulai dari sini' }), T0).headline).toBe(
      'Mulai dari sini',
    );
  });

  it('kalimat sedang mengalir (belum selesai) tetap ditampilkan; dibatasi 80 karakter', () => {
    expect(buildActivity(run({ reasoning: 'Sedang memikirkan' }), T0).headline).toBe(
      'Sedang memikirkan',
    );
    const long = buildActivity(run({ reasoning: 'a'.repeat(200) }), T0).headline ?? '';
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('null bila tak ada penalaran (Hermes tanpa penalaran) atau hanya spasi/penanda', () => {
    expect(buildActivity(run(), T0).headline).toBeNull();
    expect(buildActivity(run({ reasoning: '  \n ' }), T0).headline).toBeNull();
    expect(buildActivity(run({ reasoning: '**' }), T0).headline).toBeNull();
    expect(buildActivity(run({ reasoningSummary: '   ' }), T0).headline).toBeNull();
  });
});

describe('buildActivity: fase', () => {
  const phase = (over: Partial<LiveRun>) => buildActivity(run(over), T0 + 1000).phase;

  it('idle sebelum berjalan; thinking saat berjalan tanpa aktivitas atau setelah tool selesai', () => {
    expect(phase({ status: 'queued' })).toBe('idle');
    expect(phase({ status: 'routing' })).toBe('idle');
    expect(phase({ status: 'preparing' })).toBe('idle');
    expect(phase({ status: 'running' })).toBe('thinking');
    expect(phase({ lastActivity: 'reasoning' })).toBe('thinking');
    expect(phase({ lastActivity: 'tool', tools: [tool({ id: 'a', status: 'ok' })] })).toBe(
      'thinking',
    );
  });

  it('writing setelah teks mengalir; tool selama ada tool berjalan; aktivitas mengalahkan status queued (reload)', () => {
    expect(phase({ lastActivity: 'text', text: 'hai' })).toBe('writing');
    expect(phase({ tools: [tool({ id: 'a' })], lastActivity: 'tool' })).toBe('tool');
    expect(phase({ status: 'queued', lastActivity: 'text' })).toBe('writing');
  });

  it('waiting_approval dari status atau dari izin tertunda, mengalahkan tool', () => {
    expect(phase({ status: 'waiting_approval' })).toBe('waiting_approval');
    expect(
      phase({
        tools: [tool({ id: 'a' })],
        approvals: [
          { approvalId: 'p', kind: 'command', detail: 'ls', cwd: undefined, toolCallId: 'a' },
        ],
      }),
    ).toBe('waiting_approval');
  });

  it('terminal: done (completed, needs_review, accepted, rejected), error (failed), cancelled', () => {
    for (const status of ['completed', 'needs_review', 'accepted', 'rejected'] as const) {
      expect(phase({ status }), status).toBe('done');
    }
    expect(phase({ status: 'failed' })).toBe('error');
    expect(phase({ status: 'cancelled' })).toBe('cancelled');
    // Status terminal mengalahkan izin yang masih tercatat.
    expect(
      phase({
        status: 'cancelled',
        approvals: [
          { approvalId: 'p', kind: 'command', detail: 'ls', cwd: undefined, toolCallId: undefined },
        ],
      }),
    ).toBe('cancelled');
  });
});

describe('buildActivity: aksi saat ini dan langkah', () => {
  it('tool berjalan: kalimat berjalan + target terpisah; tanpa tool: null', () => {
    const a = buildActivity(
      run({ tools: [tool({ id: 'a', name: 'bash', target: 'npm test' })] }),
      T0 + 2000,
    );
    expect(a.current).toEqual({ label: 'Menjalankan perintah', target: 'npm test', parallel: 1 });
    expect(buildActivity(run(), T0).current).toBeNull();
    expect(buildActivity(run({ tools: [tool({ id: 'a', status: 'ok' })] }), T0).current).toBeNull();
  });

  it('beberapa tool paralel: yang paling baru dimulai + jumlah paralel', () => {
    const a = buildActivity(
      run({
        tools: [
          tool({ id: 'a', name: 'read', target: 'a.ts', startedAt: T0 + 1000 }),
          tool({ id: 'b', name: 'grep', target: 'foo', startedAt: T0 + 3000 }),
          tool({ id: 'c', name: 'bash', target: 'ls', startedAt: T0 + 2000 }),
          tool({ id: 'd', name: 'bash', status: 'ok', startedAt: T0 }),
        ],
      }),
      T0 + 5000,
    );
    expect(a.current).toEqual({ label: 'Mencari di kode', target: 'foo', parallel: 3 });
  });

  it('nama tool dikenal dipetakan ke kalimat; tak dikenal memakai kalimat umum dengan nama', () => {
    const label = (name: string) =>
      buildActivity(run({ tools: [tool({ id: 'a', name })] }), T0).current?.label;
    expect(label('bash')).toBe('Menjalankan perintah');
    expect(label('write')).toBe('Mengubah berkas');
    expect(label('edit')).toBe('Mengubah berkas');
    expect(label('read')).toBe('Membaca berkas');
    expect(label('grep')).toBe('Mencari di kode');
    expect(label('web_search')).toBe('Mencari di web');
    expect(label('fetch')).toBe('Mencari di web');
    expect(label('browser')).toBe('Membuka halaman');
    expect(label('browser_navigate')).toBe('Membuka halaman');
    expect(label('task')).toBe('Menugaskan subagent');
    expect(label('todo')).toBe('Memperbarui rencana');
    expect(label('BASH')).toBe('Menjalankan perintah');
    expect(label('mcp__github__create_issue')).toBe('Menjalankan alat: mcp__github__create_issue');
    expect(label('')).toBe('Menjalankan alat');
  });

  it('steps berurutan dengan kalimat menurut status, durasi, dan target dipotong', () => {
    const long = `node ${'x'.repeat(100)}`;
    const a = buildActivity(
      run({
        tools: [
          tool({
            id: 'a',
            name: 'bash',
            status: 'ok',
            durationMs: 1200,
            target: 'ls',
            startedAt: T0,
          }),
          tool({ id: 'b', name: 'read', status: 'error', durationMs: 30, startedAt: T0 + 1000 }),
          tool({ id: 'c', name: 'write', status: 'denied', durationMs: 5, startedAt: T0 + 2000 }),
          tool({ id: 'd', name: 'edit', status: 'cancelled', durationMs: 7, startedAt: T0 + 3000 }),
          tool({ id: 'e', name: 'bash', target: long, startedAt: T0 + 4000 }),
        ],
      }),
      T0 + 10_000,
    );
    expect(a.steps.map((s) => [s.id, s.label, s.status, s.durationMs])).toEqual([
      ['a', 'Perintah selesai', 'ok', 1200],
      ['b', 'Pembacaan berkas gagal', 'error', 30],
      ['c', 'Perubahan berkas ditolak', 'denied', 5],
      ['d', 'Perubahan berkas dibatalkan', 'cancelled', 7],
      ['e', 'Menjalankan perintah', 'running', 6000],
    ]);
    expect(a.steps[0]?.target).toBe('ls');
    expect(a.steps[1]).not.toHaveProperty('target');
    expect(a.steps[4]?.target).toHaveLength(60);
    expect(a.stepCount).toBe(5);
  });

  it('durasi tool berjalan tanpa waktu mulai tidak diketahui (null), tidak pernah negatif', () => {
    const a = buildActivity(
      run({
        tools: [tool({ id: 'a', startedAt: null }), tool({ id: 'b', startedAt: T0 + 9000 })],
      }),
      T0 + 1000,
    );
    expect(a.steps[0]?.durationMs).toBeNull();
    expect(a.steps[1]?.durationMs).toBe(0);
  });

  it('hiddenCount: langkah di luar jendela terlihat (bawaan 3, bisa diatur)', () => {
    const tools = Array.from({ length: 14 }, (_, i) =>
      tool({ id: `t${i}`, status: 'ok', durationMs: 100, startedAt: T0 + i * 1000 }),
    );
    expect(buildActivity(run({ tools }), T0 + 20_000)).toMatchObject({
      stepCount: 14,
      hiddenCount: 11,
    });
    expect(buildActivity(run({ tools }), T0, { visibleSteps: 5 }).hiddenCount).toBe(9);
    expect(buildActivity(run({ tools: tools.slice(0, 2) }), T0).hiddenCount).toBe(0);
  });
});

describe('buildActivity: waktu, ringkasan, perhatian', () => {
  it('elapsedMs = now - startedAt saat berjalan; 0 bila waktu mulai tidak diketahui; tidak negatif', () => {
    expect(buildActivity(run(), T0 + 8000).elapsedMs).toBe(8000);
    expect(buildActivity(run({ startedAt: null }), T0 + 8000).elapsedMs).toBe(0);
    expect(buildActivity(run(), T0 - 5000).elapsedMs).toBe(0);
  });

  it('berhenti di waktu selesai: endedAt, atau event terakhir bila endedAt tidak ada', () => {
    const done = run({ status: 'completed', endedAt: T0 + 6000, lastEventAt: T0 + 6100 });
    expect(buildActivity(done, T0 + 1).elapsedMs).toBe(6000);
    expect(buildActivity(done, T0 + 999_999).elapsedMs).toBe(6000);
    const noEnd = run({ status: 'failed', endedAt: null, lastEventAt: T0 + 3000 });
    expect(buildActivity(noEnd, T0 + 999_999).elapsedMs).toBe(3000);
    const noTimes = run({ status: 'cancelled', endedAt: null, lastEventAt: null });
    expect(buildActivity(noTimes, T0 + 999_999).elapsedMs).toBe(0);
  });

  it('ringkasan hanya saat terminal: "Selesai · 6 mnt 24 dtk · 14 langkah"', () => {
    const tools = Array.from({ length: 14 }, (_, i) => tool({ id: `t${i}`, status: 'ok' }));
    const done = buildActivity(
      run({ status: 'completed', endedAt: T0 + 384_000, tools }),
      T0 + 400_000,
    );
    expect(done.summary).toBe('Selesai · 6 mnt 24 dtk · 14 langkah');
    expect(buildActivity(run({ tools }), T0 + 5000).summary).toBeNull();
  });

  it('ringkasan untuk gagal, dibatalkan, dan tanpa langkah', () => {
    expect(
      buildActivity(run({ status: 'failed', endedAt: T0 + 65_000 }), T0 + 99_000).summary,
    ).toBe('Gagal · 1 mnt 05 dtk');
    expect(
      buildActivity(
        run({
          status: 'cancelled',
          endedAt: T0 + 8000,
          tools: [tool({ id: 'a', status: 'cancelled' })],
        }),
        T0 + 99_000,
      ).summary,
    ).toBe('Dibatalkan · 8 dtk · 1 langkah');
    expect(buildActivity(run({ status: 'needs_review', endedAt: T0 + 2000 }), T0).summary).toBe(
      'Selesai · 2 dtk',
    );
  });

  it('needsAttention: tool error atau menunggu persetujuan; tool ditolak/dibatalkan tidak', () => {
    expect(
      buildActivity(run({ tools: [tool({ id: 'a', status: 'error' })] }), T0).needsAttention,
    ).toBe(true);
    expect(buildActivity(run({ status: 'waiting_approval' }), T0).needsAttention).toBe(true);
    expect(
      buildActivity(
        run({
          approvals: [
            {
              approvalId: 'p',
              kind: 'command',
              detail: 'ls',
              cwd: undefined,
              toolCallId: undefined,
            },
          ],
        }),
        T0,
      ).needsAttention,
    ).toBe(true);
    expect(
      buildActivity(
        run({
          tools: [tool({ id: 'a', status: 'denied' }), tool({ id: 'b', status: 'cancelled' })],
        }),
        T0,
      ).needsAttention,
    ).toBe(false);
  });
});

describe('buildActivity: sifat', () => {
  it('tidak melempar untuk LiveRun kosong (baru dibuat, tanpa waktu)', () => {
    const a = buildActivity(newLiveRun('kosong'), 0);
    expect(a).toEqual({
      headline: null,
      phase: 'idle',
      current: null,
      stepCount: 0,
      hiddenCount: 0,
      elapsedMs: 0,
      steps: [],
      summary: null,
      needsAttention: false,
    });
  });

  it('now tidak dibaca dari jam: hasil sama untuk masukan sama', () => {
    const live = run({ tools: [tool({ id: 'a' })] });
    expect(buildActivity(live, T0 + 5000)).toEqual(buildActivity(live, T0 + 5000));
  });
});
