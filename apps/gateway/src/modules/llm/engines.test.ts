import type { AcpProbeResult } from '@aios/adapters';
import { describe, expect, it, vi } from 'vitest';
import { createEnginesService, type EnginesDeps } from './engines.js';

const build = (over: Partial<EnginesDeps> = {}) =>
  createEnginesService({
    workersOnline: () => Promise.resolve(1),
    hermesUp: () => Promise.resolve(true),
    ...over,
  });

const byId = async (service: ReturnType<typeof build>, id: string) =>
  (await service.list()).find((engine) => engine.id === id)!;

describe('layanan /engines', () => {
  it('melaporkan hermes, omp, dsh berurutan dengan kemampuan masing-masing', async () => {
    const list = await build({ dsh: { probe: () => Promise.resolve({ ok: true }) } }).list();
    expect(list).toEqual([
      {
        id: 'hermes',
        label: 'Hermes',
        available: true,
        experimental: false,
        supportsModelPick: false,
        supportsTodo: false,
      },
      {
        id: 'omp',
        label: 'omp',
        available: true,
        experimental: false,
        supportsModelPick: true,
        supportsTodo: true,
      },
      {
        id: 'dsh',
        label: 'dsh',
        available: true,
        experimental: true,
        supportsModelPick: true,
        supportsTodo: false,
      },
    ]);
  });

  it('dsh tanpa DSH_COMMAND: tidak tersedia, alasan menyebut konfigurasi, proses tidak diluncurkan', async () => {
    const dsh = await byId(build(), 'dsh');
    expect(dsh).toMatchObject({ available: false, experimental: true });
    expect(dsh.reason).toContain('DSH_COMMAND');
  });

  it('dsh terkonfigurasi tetapi proses gagal jabat tangan: tidak tersedia; galat rinci hanya ke log', async () => {
    const warn = vi.fn();
    const failed: AcpProbeResult = { ok: false, reason: 'spawn /opt/rahasia/dsh ENOENT' };
    const service = build({ dsh: { probe: () => Promise.resolve(failed) }, log: { warn } });
    const dsh = await byId(service, 'dsh');
    expect(dsh.available).toBe(false);
    expect(dsh.reason).toBe('Proses dsh tidak menjawab pemeriksaan kesehatan.');
    expect(JSON.stringify(dsh)).not.toContain('/opt/rahasia');
    expect(warn).toHaveBeenCalledWith(
      { reason: 'spawn /opt/rahasia/dsh ENOENT' },
      expect.any(String),
    );
  });

  it('probe yang melempar dihitung gagal, bukan membuat daftar error', async () => {
    const dsh = await byId(
      build({ dsh: { probe: () => Promise.reject(new Error('meledak')) } }),
      'dsh',
    );
    expect(dsh.available).toBe(false);
  });

  it('hasil probe dipakai ulang selama TTL, lalu diperiksa lagi', async () => {
    let clock = 1000;
    const probe = vi.fn(() => Promise.resolve<AcpProbeResult>({ ok: true }));
    const service = build({ dsh: { probe }, now: () => clock, probeTtlMs: 30_000 });
    await service.list();
    clock += 29_000;
    await service.list();
    expect(probe).toHaveBeenCalledTimes(1);
    clock += 2000;
    await service.list();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('omp tanpa worker tersambung dan Hermes mati dilaporkan tidak tersedia dengan alasan', async () => {
    const service = build({
      workersOnline: () => Promise.resolve(0),
      hermesUp: () => Promise.resolve(false),
    });
    expect(await byId(service, 'omp')).toMatchObject({
      available: false,
      reason: 'Tidak ada worker Windows yang tersambung.',
    });
    expect(await byId(service, 'hermes')).toMatchObject({
      available: false,
      reason: 'Hermes tidak menjawab pemeriksaan kesehatan.',
    });
  });
});
