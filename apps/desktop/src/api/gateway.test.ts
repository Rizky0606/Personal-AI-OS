import { describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { apiErrorMessage } from './errors';
import { ResponseShapeError, createGatewayApi } from './gateway';

const ID = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';
const OTHER = '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90';
const TS = '2026-10-22T06:38:00Z';

const conversation = {
  id: ID,
  title: 'Halo',
  surface: 'windows',
  projectId: null,
  spaceId: null,
  pinned: false,
  archivedAt: null,
  createdAt: TS,
  updatedAt: TS,
};

describe('createGatewayApi', () => {
  it('mengurai respons yang sesuai kontrak dan membangun query kursor', async () => {
    const call = vi.fn().mockResolvedValue({ items: [conversation], nextBefore: OTHER });
    const api = createGatewayApi(call);

    const result = await api.listConversations(ID);

    expect(call).toHaveBeenCalledWith(`/conversations?before=${ID}&limit=50`, undefined);
    expect(result.items[0]?.title).toBe('Halo');
    expect(result.nextBefore).toBe(OTHER);
  });

  it('tanpa kursor tidak mengirim parameter before', async () => {
    const call = vi.fn().mockResolvedValue({ items: [], nextBefore: null });

    await createGatewayApi(call).listMessages(ID);

    expect(call).toHaveBeenCalledWith(`/conversations/${ID}/messages?limit=50`, undefined);
  });

  it('respons yang melenceng dari kontrak gagal dengan ResponseShapeError', async () => {
    const call = vi.fn().mockResolvedValue({ items: [{ id: 'bukan-uuid' }], nextBefore: null });

    await expect(createGatewayApi(call).listConversations()).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it('sendMessage mengirim bagian teks dan hanya menyertakan role/model bila dipilih', async () => {
    const call = vi.fn().mockRejectedValue(new Error('berhenti'));
    const api = createGatewayApi(call);

    await api.sendMessage(ID, { text: 'Halo' }).catch(() => undefined);
    await api
      .sendMessage(ID, { text: 'Halo', role: 'writer', model: 'combo/fast' })
      .catch(() => undefined);

    expect(call.mock.calls[0]?.[1]).toEqual({
      method: 'POST',
      body: { parts: [{ type: 'text', text: 'Halo' }] },
    });
    expect(call.mock.calls[1]?.[1]).toEqual({
      method: 'POST',
      body: { parts: [{ type: 'text', text: 'Halo' }], role: 'writer', model: 'combo/fast' },
    });
  });

  it('ekspor meminta isi mentah dengan format di query', async () => {
    const blob = new Blob(['x']);
    const call = vi.fn().mockResolvedValue(blob);

    expect(await createGatewayApi(call).exportResearch(ID, 'pdf')).toBe(blob);
    expect(call).toHaveBeenCalledWith(`/research/${ID}/export?format=pdf`, { raw: true });
  });

  it('team cancellation sends POST to the team cancel endpoint', async () => {
    const call = vi.fn().mockResolvedValue({
      id: ID,
      projectId: OTHER,
      status: 'running',
      memberCount: 0,
      pendingApprovals: 0,
      createdAt: TS,
      updatedAt: TS,
      parentRunId: null,
      prompt: 'x',
      limits: {
        maxWorkers: 1,
        maxReviewRounds: 2,
        teamTimeoutMinutes: 120,
        memberTimeoutMinutes: 30,
        stepsPerMember: 100,
        tokensPerTeam: 100000,
        tokensPerMember: 40000,
        inputTokensPerCall: 20000,
        outputTokensPerCall: 8000,
      },
      members: [],
      cancelRequestedAt: null,
      failureCode: null,
      finishedAt: null,
    });

    await createGatewayApi(call).cancelTeam(ID);

    expect(call).toHaveBeenCalledWith(`/teams/${ID}/cancel`, { method: 'POST' });
  });

  it('hapus dan arsip menerima 204 tanpa isi', async () => {
    const call = vi.fn().mockResolvedValue(null);
    const api = createGatewayApi(call);

    await expect(api.archiveConversation(ID)).resolves.toBeUndefined();
    await expect(api.deleteSchedule(ID)).resolves.toBeUndefined();
    expect(call).toHaveBeenCalledWith(`/conversations/${ID}`, { method: 'DELETE' });
  });
});

describe('apiErrorMessage', () => {
  it('memetakan status ke pesan dengan langkah berikutnya', () => {
    expect(apiErrorMessage(new ApiProblem(401, 'x', ''), true)).toBe(copy.errors.session);
    expect(apiErrorMessage(new ApiProblem(404, 'x', ''), true)).toBe(copy.errors.notFound);
    expect(apiErrorMessage(new ApiProblem(409, 'x', ''), true)).toBe(copy.errors.conflict);
    expect(apiErrorMessage(new ApiProblem(422, 'x', ''), true)).toBe(copy.errors.unprocessable);
    expect(apiErrorMessage(new ApiProblem(429, 'x', ''), true)).toBe(copy.errors.rateLimited);
    expect(apiErrorMessage(new ApiProblem(502, 'x', ''), true)).toBe(copy.errors.server);
  });

  it('jaringan: offline dibedakan dari server tak terjangkau', () => {
    expect(apiErrorMessage(new ApiProblem(0, 'network', ''), true)).toBe(copy.errors.network);
    expect(apiErrorMessage(new ApiProblem(0, 'network', ''), false)).toBe(copy.errors.offline);
    expect(apiErrorMessage(new Error('?'), true)).toBe(copy.errors.unknown);
    expect(apiErrorMessage(new ResponseShapeError('/x'), true)).toBe(copy.errors.shape);
  });
});
