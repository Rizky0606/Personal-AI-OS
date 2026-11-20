import type { AgentEvent, WorkerCommand } from '@aios/contracts';
import { describe, expect, it } from 'vitest';
import { createWorkerRelay } from './relay.js';

const PROJECT = '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92';
const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const OLD = 'perangkat-lama';
const NEW = 'perangkat-baru';

/** Relay dengan hub tiruan: `online` menentukan perangkat yang tersambung, `owner` pemilik project. */
function setup() {
  const online = new Set<string>([OLD]);
  const sent: { deviceId: string; command: WorkerCommand }[] = [];
  let owner = OLD;
  const relay = createWorkerRelay({
    hub: {
      send: (deviceId, command) => {
        if (!online.has(deviceId)) return false;
        sent.push({ deviceId, command });
        return true;
      },
      isOnline: (deviceId) => online.has(deviceId),
    },
    projects: { workerOf: () => Promise.resolve(owner) },
  });
  const calls: string[] = [];
  const events: AgentEvent[] = [];
  const listen = () =>
    relay.listen(RUN, PROJECT, {
      onEvent: (event) => events.push(event),
      onDisconnect: (replaced) => calls.push(replaced ? 'disconnect:replaced' : 'disconnect'),
      onReconnect: () => calls.push('reconnect'),
    });
  return {
    relay,
    online,
    sent,
    calls,
    events,
    listen,
    /** Desktop login ulang: project pindah ke perangkat baru, lalu relay diberi tahu. */
    replace: () => {
      owner = NEW;
      relay.moveDevice([OLD], NEW);
    },
  };
}

describe('WorkerRelay: worker diganti atau dimulai ulang saat run berjalan', () => {
  it('perangkat baru online tidak menyambung ulang run lama; laporan tanpa run itu mengakhirinya worker_replaced', async () => {
    const t = setup();
    await t.listen();

    t.replace();
    t.online.delete(OLD);
    t.relay.presence(OLD, false);
    t.online.add(NEW);
    t.relay.presence(NEW, true);

    expect(t.calls).toEqual(['disconnect:replaced']);
    t.relay.activeRuns(NEW, []);
    expect(t.events).toEqual([
      expect.objectContaining({ type: 'error', code: 'worker_replaced', retryable: true }),
    ]);
  });

  it('worker baru memegang run (proses sama, sesi baru): runs.active atau event run itu menyambungkannya lagi', async () => {
    const reported = setup();
    await reported.listen();
    reported.replace();
    reported.relay.activeRuns(NEW, [RUN]);
    expect(reported.calls).toEqual(['disconnect:replaced', 'reconnect']);
    expect(reported.events).toEqual([]);
    // Sudah terbukti: laporan berikutnya tanpa run ini tidak mengakhirinya.
    reported.relay.activeRuns(NEW, []);
    expect(reported.events).toEqual([]);

    const streamed = setup();
    await streamed.listen();
    streamed.replace();
    // Event dari perangkat lama ditolak; dari perangkat baru diterima dan menyambungkan run.
    expect(streamed.relay.feed(OLD, RUN, { type: 'run.status', status: 'running' })).toBe(
      'not_owned',
    );
    expect(streamed.relay.feed(NEW, RUN, { type: 'run.status', status: 'running' })).toBe('ok');
    expect(streamed.calls).toEqual(['disconnect:replaced', 'reconnect']);
  });

  it('perangkat sama dimulai ulang: run yang tidak dilaporkan gagal worker_restarted; run.start setelah pulih tidak terdampak', async () => {
    const t = setup();
    await t.listen();
    t.relay.presence(OLD, false);
    t.relay.presence(OLD, true);
    expect(t.calls).toEqual(['disconnect', 'reconnect']);

    t.relay.activeRuns(OLD, []);
    expect(t.events).toEqual([
      expect.objectContaining({ type: 'error', code: 'worker_restarted', retryable: true }),
    ]);

    // Run yang dikirim lewat koneksi yang hidup setelah putus tidak menunggu konfirmasi.
    const fresh = setup();
    await fresh.listen();
    fresh.relay.presence(OLD, false);
    fresh.relay.presence(OLD, true);
    await fresh.relay.send(PROJECT, {
      type: 'run.start',
      runId: RUN,
      projectId: PROJECT,
      prompt: 'x',
      bundle: { role: 'general', systemPrompt: '', skillIds: [] },
      model: 'default',
    });
    fresh.relay.activeRuns(OLD, []);
    expect(fresh.events).toEqual([]);
  });

  it('laporan tanpa run dari perangkat yang koneksinya tidak pernah putus tidak mengakhiri run', async () => {
    const t = setup();
    await t.listen();
    t.relay.activeRuns(OLD, []);
    expect(t.events).toEqual([]);
    expect(t.calls).toEqual([]);
  });
});
