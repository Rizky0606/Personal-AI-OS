import { describe, expect, it, vi } from 'vitest';
import type { Complete } from '@aios/roles';
import { AppError } from '../../errors.js';
import { createTaskBreakdown } from './breakdown.js';

const roles = {
  list: () => [
    { id: 'frontend', name: 'Frontend', engine: 'omp' },
    { id: 'backend', name: 'Backend', engine: 'omp' },
    { id: 'general', name: 'Umum', engine: 'hermes' },
  ],
};
const project = { name: 'Toko', stack: 'typescript, react' };

const replying = (...replies: string[]) => {
  const complete = vi.fn<Complete>();
  for (const reply of replies) complete.mockResolvedValueOnce(reply);
  return complete;
};

describe('createTaskBreakdown', () => {
  it('mengubah ide jadi kartu dengan role coding; role di luar daftar menjadi null', async () => {
    const complete = replying(
      '```json\n{"items":[{"title":"Buat halaman login","body":"Form email + sandi","role":"frontend"},' +
        '{"title":"Endpoint /login","body":"","role":"backend"},{"title":"Tulis catatan rilis","role":"general"}]}\n```',
    );
    const result = await createTaskBreakdown({ complete, roles }).split('Buat login', project);

    expect(result.items).toEqual([
      { title: 'Buat halaman login', body: 'Form email + sandi', agentRole: 'frontend' },
      { title: 'Endpoint /login', body: '', agentRole: 'backend' },
      { title: 'Tulis catatan rilis', body: '', agentRole: null },
    ]);
    const prompt = JSON.stringify(complete.mock.calls[0]![0].messages);
    expect(prompt).toContain('frontend (Frontend), backend (Backend)');
    expect(prompt).not.toContain('general (Umum)');
    expect(prompt).toContain('Toko (typescript, react)');
  });

  it('balasan salah diperbaiki sekali lewat umpan balik; item tanpa title ditolak', async () => {
    const complete = replying('bukan json', '{"items":[{"title":"  ","role":"backend"}]}');
    await expect(
      createTaskBreakdown({ complete, roles }).split('x', project),
    ).rejects.toMatchObject({
      status: 422,
      code: 'breakdown_unparseable',
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(complete.mock.calls[1]![0].messages)).toContain('Balasanmu ditolak');
  });

  it('model menolak ide (bukan pekerjaan coding): alasannya diteruskan sebagai 422', async () => {
    const complete = replying('{"items":[],"error":"Itu bukan pekerjaan coding."}');
    const error = await createTaskBreakdown({ complete, roles })
      .split('Resep nasi goreng', project)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 422 });
    expect((error as AppError).message).toContain('bukan pekerjaan coding');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('dibatasi 8 kartu; model tidak terjangkau menjadi 502', async () => {
    const many = JSON.stringify({
      items: Array.from({ length: 12 }, (_, i) => ({ title: `K${i}`, body: '', role: 'backend' })),
    });
    const result = await createTaskBreakdown({ complete: replying(many), roles }).split(
      'x',
      project,
    );
    expect(result.items).toHaveLength(8);

    const down = vi.fn<Complete>().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      createTaskBreakdown({ complete: down, roles }).split('x', project),
    ).rejects.toMatchObject({
      status: 502,
      code: 'router_unavailable',
    });
  });
});
