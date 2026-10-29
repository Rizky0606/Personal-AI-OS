import type { AgentEvent, WorkerCommand } from '@aios/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createWorkerRelayAdapter, type WorkerRelayPort } from './worker-relay.js';
import { AdapterError, type RunHandle } from './types.js';

const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const MESSAGE = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
const WORKER_MESSAGE = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const PROJECT = '0192f0c4-7a1b-7c2d-a002-4a5b6c7d8e92';
const APPROVAL = '0192f0c4-7a1b-7c2d-a003-4a5b6c7d8e93';

function fakePort() {
  const sent: WorkerCommand[] = [];
  let handlers:
    | { onEvent: (e: AgentEvent) => void; onDisconnect: () => void; onReconnect: () => void }
    | undefined;
  const stop = vi.fn();
  const port: WorkerRelayPort = {
    send: (_projectId, command) => {
      sent.push(command);
      return Promise.resolve();
    },
    listen: (_runId, _projectId, h) => {
      handlers = h;
      return Promise.resolve(stop);
    },
  };
  return {
    port,
    sent,
    stop,
    emit: (e: AgentEvent) => handlers?.onEvent(e),
    disconnect: () => handlers?.onDisconnect(),
    reconnect: () => handlers?.onReconnect(),
  };
}

const input = (over = {}) => ({
  runId: RUN,
  messageId: MESSAGE,
  prompt: 'tambahkan tes',
  systemPrompt: '# Peran',
  model: 'combo/code',
  projectId: PROJECT,
  role: 'frontend',
  ...over,
});

async function drain(handle: RunHandle): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of handle.events) events.push(event);
  return events;
}

describe('createWorkerRelayAdapter', () => {
  it('mengirim run.start berisi project, prompt, bundle role, dan model ke worker', async () => {
    const t = fakePort();
    const adapter = createWorkerRelayAdapter({ relay: t.port });

    await adapter.startRun(input());

    expect(t.sent).toEqual([
      {
        type: 'run.start',
        runId: RUN,
        projectId: PROJECT,
        prompt: 'tambahkan tes',
        bundle: { role: 'frontend', systemPrompt: '# Peran' },
        model: 'combo/code',
      },
    ]);
    expect(adapter.id).toBe('omp');
    expect(adapter.capabilities()).toMatchObject({ approvals: true, steer: true });
  });

  it('event diteruskan berurutan; ID pesan diganti ID asisten gateway; run.status dari worker dibuang', async () => {
    const t = fakePort();
    const handle = await createWorkerRelayAdapter({ relay: t.port }).startRun(input());

    t.emit({ type: 'run.status', status: 'running' });
    t.emit({ type: 'tool.started', toolCallId: 'c1', name: 'bash', target: 'node --test' });
    t.emit({ type: 'message.delta', messageId: WORKER_MESSAGE, text: 'Halo' });
    t.emit({ type: 'message.completed', messageId: WORKER_MESSAGE });
    t.emit({ type: 'run.completed', summary: 'selesai' });

    expect(await drain(handle)).toEqual([
      { type: 'tool.started', toolCallId: 'c1', name: 'bash', target: 'node --test' },
      { type: 'message.delta', messageId: MESSAGE, text: 'Halo' },
      { type: 'message.completed', messageId: MESSAGE },
      { type: 'run.completed', summary: 'selesai' },
    ]);
    expect(t.stop).toHaveBeenCalled();
  });

  it('event error dari worker menutup aliran setelah diteruskan', async () => {
    const t = fakePort();
    const handle = await createWorkerRelayAdapter({ relay: t.port }).startRun(input());

    t.emit({
      type: 'error',
      code: 'project_not_bound',
      message: 'Belum terikat.',
      retryable: false,
    });
    t.emit({ type: 'message.delta', messageId: WORKER_MESSAGE, text: 'terlambat' });

    expect(await drain(handle)).toEqual([
      { type: 'error', code: 'project_not_bound', message: 'Belum terikat.', retryable: false },
    ]);
  });

  it('run.status cancelled menutup tanpa event; failed menjadi error run_failed', async () => {
    const a = fakePort();
    const cancelled = await createWorkerRelayAdapter({ relay: a.port }).startRun(input());
    a.emit({ type: 'run.status', status: 'cancelled' });
    expect(await drain(cancelled)).toEqual([]);

    const b = fakePort();
    const failed = await createWorkerRelayAdapter({ relay: b.port }).startRun(input());
    b.emit({ type: 'run.status', status: 'failed' });
    expect((await drain(failed))[0]).toMatchObject({ type: 'error', code: 'run_failed' });
  });

  it('cancel mengirim run.cancel; aliran ditutup saat worker mengonfirmasi, atau paksa setelah masa tunggu', async () => {
    const confirmed = fakePort();
    const h1 = await createWorkerRelayAdapter({ relay: confirmed.port }).startRun(input());
    await h1.cancel();
    expect(confirmed.sent.at(-1)).toEqual({ type: 'run.cancel', runId: RUN });
    confirmed.emit({ type: 'run.status', status: 'cancelled' });
    expect(await drain(h1)).toEqual([]);

    const silent = fakePort();
    const h2 = await createWorkerRelayAdapter({ relay: silent.port, cancelGraceMs: 30 }).startRun(
      input(),
    );
    await h2.cancel();
    expect(await drain(h2)).toEqual([]);
  });

  it('abort dari luar membatalkan run', async () => {
    const t = fakePort();
    const controller = new AbortController();
    await createWorkerRelayAdapter({ relay: t.port }).startRun(
      input({ signal: controller.signal }),
    );

    controller.abort();
    await new Promise((r) => setTimeout(r, 10));

    expect(t.sent.at(-1)).toEqual({ type: 'run.cancel', runId: RUN });
  });

  it('steer dan resolveApproval menjadi perintah ke worker; setelah selesai ditolak', async () => {
    const t = fakePort();
    const handle = await createWorkerRelayAdapter({ relay: t.port }).startRun(input());

    await handle.steer('fokus ke tes');
    await handle.resolveApproval(APPROVAL, 'allow', true);
    expect(t.sent.slice(1)).toEqual([
      { type: 'run.steer', runId: RUN, text: 'fokus ke tes' },
      {
        type: 'approval.resolve',
        runId: RUN,
        approvalId: APPROVAL,
        decision: 'allow',
        remember: true,
      },
    ]);

    t.emit({ type: 'run.completed', summary: 's' });
    await drain(handle);
    await expect(handle.steer('x')).rejects.toBeInstanceOf(AdapterError);
    await expect(handle.resolveApproval(APPROVAL, 'deny')).rejects.toBeInstanceOf(AdapterError);
  });

  it('follow-up diteruskan dengan mode; steer biasa tetap tanpa mode (kompatibel dengan worker lama)', async () => {
    const t = fakePort();
    const handle = await createWorkerRelayAdapter({ relay: t.port }).startRun(input());

    await handle.steer('lalu lint', 'followUp');
    await handle.steer('fokus', 'steer');

    expect(t.sent.slice(1)).toEqual([
      { type: 'run.steer', runId: RUN, text: 'lalu lint', mode: 'followUp' },
      { type: 'run.steer', runId: RUN, text: 'fokus' },
    ]);
  });

  it('removeQueued menjadi perintah queue.remove ke worker', async () => {
    const t = fakePort();
    const handle = await createWorkerRelayAdapter({ relay: t.port }).startRun(input());

    await handle.removeQueued('followUp', 'lalu lint');

    expect(t.sent.slice(1)).toEqual([
      { type: 'queue.remove', runId: RUN, queue: 'followUp', text: 'lalu lint' },
    ]);
  });

  it('jawaban pertanyaan agent menjadi perintah question.answer; setelah selesai ditolak', async () => {
    const t = fakePort();
    const handle = await createWorkerRelayAdapter({ relay: t.port }).startRun(input());

    await handle.answerQuestion(APPROVAL, {
      answers: [{ id: 'db', selectedOptions: ['SQLite'], customInput: 'dan Search' }],
      cancelled: false,
    });

    expect(t.sent.slice(1)).toEqual([
      {
        type: 'question.answer',
        runId: RUN,
        questionId: APPROVAL,
        answers: [{ id: 'db', selectedOptions: ['SQLite'], customInput: 'dan Search' }],
        cancelled: false,
      },
    ]);
    t.emit({ type: 'run.completed', summary: 's' });
    await drain(handle);
    await expect(
      handle.answerQuestion(APPROVAL, { answers: [], cancelled: true }),
    ).rejects.toBeInstanceOf(AdapterError);
  });

  it('worker tidak tersambung saat mulai: startRun gagal dan pendengar dilepas', async () => {
    const t = fakePort();
    t.port.send = () =>
      Promise.reject(new AdapterError('worker_offline', 'Worker belum tersambung.', true));

    await expect(
      createWorkerRelayAdapter({ relay: t.port }).startRun(input()),
    ).rejects.toMatchObject({
      code: 'worker_offline',
      retryable: true,
    });
    expect(t.stop).toHaveBeenCalled();
  });

  it('putus lebih lama dari masa tunggu: error worker_disconnected; pulih sebelum itu: lanjut', async () => {
    const lost = fakePort();
    const h1 = await createWorkerRelayAdapter({ relay: lost.port, disconnectGraceMs: 30 }).startRun(
      input(),
    );
    lost.disconnect();
    expect((await drain(h1))[0]).toMatchObject({
      type: 'error',
      code: 'worker_disconnected',
      retryable: true,
    });

    const blip = fakePort();
    const h2 = await createWorkerRelayAdapter({ relay: blip.port, disconnectGraceMs: 60 }).startRun(
      input(),
    );
    blip.disconnect();
    await new Promise((r) => setTimeout(r, 20));
    blip.reconnect();
    await new Promise((r) => setTimeout(r, 80));
    blip.emit({ type: 'run.completed', summary: 'tetap selesai' });
    expect(await drain(h2)).toEqual([{ type: 'run.completed', summary: 'tetap selesai' }]);
  });

  it('tanpa project ditolak sebelum menghubungi worker', async () => {
    const t = fakePort();

    await expect(
      createWorkerRelayAdapter({ relay: t.port }).startRun(input({ projectId: undefined })),
    ).rejects.toMatchObject({ code: 'project_required' });
    expect(t.sent).toEqual([]);
  });
});
