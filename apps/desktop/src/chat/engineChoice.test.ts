import type { EngineInfo } from '@aios/contracts';
import { describe, expect, it } from 'vitest';
import { copy } from '../copy';
import { engineView, parseEngines, wireEngine, withEngine } from './engineChoice';

const info = (over: Partial<EngineInfo> & Pick<EngineInfo, 'id'>): EngineInfo => ({
  label: over.id,
  available: true,
  experimental: false,
  supportsModelPick: true,
  supportsTodo: false,
  ...over,
});

const REPORT: EngineInfo[] = [
  info({ id: 'hermes', supportsModelPick: false }),
  info({ id: 'omp', supportsTodo: true }),
  info({ id: 'dsh', experimental: true }),
];

const option = (view: ReturnType<typeof engineView>, value: string) =>
  view.options.find((o) => o.value === value)!;

describe('engineView: ketersediaan menurut gateway dan konteks', () => {
  it('chat umum: Otomatis, Hermes, dsh bisa dipilih; omp nonaktif karena butuh project', () => {
    const view = engineView('auto', REPORT, false);
    expect(view.options.map((o) => [o.value, o.disabled])).toEqual([
      ['auto', false],
      ['omp', true],
      ['hermes', false],
      ['dsh', false],
    ]);
    expect(option(view, 'omp').reason).toBe(copy.chat.engine.needsProject);
    expect(view.engineId).toBe('hermes');
  });

  it('di dalam project: omp dan Hermes bisa dipilih; dsh nonaktif karena hanya untuk chat umum', () => {
    const view = engineView('auto', REPORT, true);
    expect(option(view, 'omp').disabled).toBe(false);
    expect(option(view, 'hermes').disabled).toBe(false);
    expect(option(view, 'dsh').reason).toBe(copy.chat.engine.generalOnly);
    expect(view.engineId).toBe('omp');
    // Hermes dipaksa di project: mesin yang menjawab Hermes, jadi model dikunci dan tanpa rencana.
    expect(engineView('hermes', REPORT, true)).toMatchObject({
      effective: 'hermes',
      engineId: 'hermes',
      supportsModelPick: false,
      supportsTodo: false,
    });
  });

  it('mesin yang dilaporkan tidak tersedia tampil nonaktif dengan alasan dari gateway apa adanya', () => {
    const report = [
      ...REPORT.filter((e) => e.id !== 'dsh'),
      info({
        id: 'dsh',
        available: false,
        experimental: true,
        reason: 'Belum dikonfigurasi di server.',
      }),
    ];
    const view = engineView('dsh', report, false);
    expect(option(view, 'dsh')).toMatchObject({
      disabled: true,
      reason: 'Belum dikonfigurasi di server.',
      preview: true,
    });
    // Pilihan tersimpan yang tidak bisa dipakai lagi jatuh ke Otomatis, bukan dikirim diam-diam.
    expect(view.effective).toBe('auto');
    expect(wireEngine(view.effective)).toBeUndefined();
  });

  it('sebelum laporan gateway tiba, hanya Otomatis yang bisa dipilih', () => {
    const view = engineView('dsh', undefined, false);
    expect(view.effective).toBe('auto');
    expect(option(view, 'hermes').reason).toBe(copy.chat.engine.unknown);
    expect(option(view, 'dsh').disabled).toBe(true);
  });

  it('pilihan eksplisit dikirim apa adanya, ditandai pratinjau untuk dsh', () => {
    const view = engineView('dsh', REPORT, false);
    expect(view.effective).toBe('dsh');
    expect(option(view, 'dsh').preview).toBe(true);
    expect(wireEngine(view.effective)).toBe('dsh');
    // Hermes dan omp ikut dikirim bila dipilih sendiri; hanya Otomatis yang tidak mengirim apa pun.
    expect(wireEngine('auto')).toBeUndefined();
    expect(wireEngine('hermes')).toBe('hermes');
    expect(wireEngine('omp')).toBe('omp');
  });

  it('kemampuan mengikuti mesin yang menjawab: Hermes kunci model, dsh dan omp membuka; todo hanya omp', () => {
    expect(engineView('auto', REPORT, false)).toMatchObject({
      supportsModelPick: false,
      supportsTodo: false,
    });
    expect(engineView('dsh', REPORT, false)).toMatchObject({
      supportsModelPick: true,
      supportsTodo: false,
    });
    expect(engineView('auto', REPORT, true)).toMatchObject({
      supportsModelPick: true,
      supportsTodo: true,
    });
  });
});

describe('pilihan tersimpan per percakapan', () => {
  it('Otomatis = bawaan, jadi dihapus; pilihan lain disimpan per kunci', () => {
    const saved = withEngine({}, 'c1', 'dsh');
    expect(saved).toEqual({ c1: 'dsh' });
    expect(withEngine(saved, 'c2', 'omp')).toEqual({ c1: 'dsh', c2: 'omp' });
    expect(withEngine(saved, 'c1', 'auto')).toEqual({});
  });

  it('dibatasi pada 100 percakapan terbaru', () => {
    let saved: Record<string, 'dsh'> = {};
    for (let i = 0; i < 120; i++)
      saved = withEngine(saved, `c${i}`, 'dsh') as Record<string, 'dsh'>;
    const keys = Object.keys(saved);
    expect(keys).toHaveLength(100);
    expect(keys[0]).toBe('c20');
    expect(keys.at(-1)).toBe('c119');
  });

  it('nilai tersimpan yang rusak dibuang', () => {
    expect(parseEngines({ a: 'dsh', b: 'bukan-mesin', c: 7, d: 'auto', '': 'dsh' })).toEqual({
      a: 'dsh',
    });
    expect(parseEngines(null)).toEqual({});
    expect(parseEngines(['dsh'])).toEqual({});
    expect(parseEngines('dsh')).toEqual({});
  });
});
