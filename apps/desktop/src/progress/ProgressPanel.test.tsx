import type { ConversationProgress, TodoPhase } from '@aios/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, emit, emptyProgress, resetApi, runs } from '../test/fakeServices';
import { uid } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { ProgressPanel } = await import('./ProgressPanel');

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      resolve(HERE, `../../../../packages/contracts/fixtures/progress/${name}.json`),
      'utf8',
    ),
  ) as { response: ConversationProgress };

const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f01';
// Pelacak run adalah singleton: tiap tes memakai ID run sendiri supaya urutan event (seq) tidak bentrok.
let RUN = '';
const p = copy.progress;

const source = (runId: string | null = null) =>
  useUiStore.setState({ progressSource: { conversationId: CONV, runId, savedTools: [] } });

const tasks = (statuses: ('completed' | 'in_progress' | 'pending' | 'blocked')[]): TodoPhase[] => [
  {
    name: 'Rencana',
    tasks: statuses.map((status, i) => ({
      content: `Langkah ${i + 1}`,
      status,
      ...(status === 'blocked' ? { blocker: 'Butuh izin' } : {}),
    })),
  },
];
const withPlan = (phases: TodoPhase[]): ConversationProgress => ({
  ...emptyProgress(),
  plan: { runId: RUN, phases },
});

beforeEach(() => {
  RUN = uid();
  resetApi();
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  useUiStore.setState(useUiStore.getInitialState(), true);
});

describe('ProgressPanel: empat state', () => {
  it('kosong: tanpa percakapan terbuka, pesan dan aksi menuju kolom pesan', async () => {
    await renderScreen(<ProgressPanel />);
    expect(screen.getByRole('region', { name: p.region })).toBeInTheDocument();
    expect(screen.getByText(p.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: p.emptyAction })).toBeInTheDocument();
  });

  it('kosong: percakapan ada tetapi belum ada aktivitas', async () => {
    source();
    await renderScreen(<ProgressPanel />);
    expect(await screen.findByText(p.empty)).toBeInTheDocument();
  });

  it('memuat: kerangka berlabel selama agregat belum tiba', async () => {
    source();
    api.getConversationProgress.mockReturnValue(new Promise(() => undefined));
    await renderScreen(<ProgressPanel />);
    expect(await screen.findByRole('status', { name: p.loading })).toBeInTheDocument();
  });

  it('error: pesan dan tombol Coba lagi yang memuat ulang', async () => {
    source();
    api.getConversationProgress.mockRejectedValueOnce(new Error('x'));
    const user = userEvent.setup();
    await renderScreen(<ProgressPanel />);
    const retry = await screen.findByRole('button', { name: copy.states.retry });
    api.getConversationProgress.mockResolvedValue(withPlan(tasks(['in_progress', 'pending'])));
    await user.click(retry);
    expect(await screen.findByRole('list', { name: p.timeline })).toBeInTheDocument();
  });

  it('sukses: ketiga bagian tampil dengan judul kecil', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(fixture('reload-complete').response);
    await renderScreen(<ProgressPanel />);
    for (const title of [p.sections.progress, p.sections.outputs, p.sections.used]) {
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('offline dengan data terakhir: isi tetap tampil dengan tanda offline', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(fixture('reload-complete').response);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      await renderScreen(<ProgressPanel />);
      expect(await screen.findByRole('list', { name: p.timeline })).toBeInTheDocument();
      expect(screen.getByText(p.offline)).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    }
  });
});

describe('ProgressPanel: linimasa', () => {
  it('daftar berurutan (ol) dengan status di teks, langkah aktif ditandai aria-current', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(
      withPlan(tasks(['completed', 'in_progress', 'pending', 'blocked'])),
    );
    await renderScreen(<ProgressPanel />);
    const list = await screen.findByRole('list', { name: p.timeline });
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent(`${p.state.done}: Langkah 1`);
    expect(items[1]).toHaveTextContent(`${p.state.active}: Langkah 2`);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[2]).toHaveTextContent(`${p.state.pending}: Langkah 3`);
    expect(items[3]).toHaveTextContent(`${p.state.blocked}: Langkah 4`);
    expect(items[3]).toHaveTextContent('Butuh izin');
  });

  it('lebih dari dua langkah selesai: yang lama diringkas "N langkah sebelumnya" (tombol aria-expanded) dan bisa dibuka', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(
      withPlan(
        tasks([
          'completed',
          'completed',
          'completed',
          'completed',
          'completed',
          'in_progress',
          'pending',
        ]),
      ),
    );
    const user = userEvent.setup();
    await renderScreen(<ProgressPanel />);
    const list = await screen.findByRole('list', { name: p.timeline });
    // 5 selesai: 3 diringkas, 2 terakhir redup terlihat, lalu aktif dan berikutnya.
    const toggle = within(list).getByRole('button', { name: p.previous(3) });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(list).queryByText('Langkah 1')).not.toBeInTheDocument();
    expect(within(list).getByText('Langkah 4')).toBeInTheDocument();
    expect(within(list).getByText('Langkah 5')).toBeInTheDocument();

    await user.click(toggle);
    expect(within(list).getByText('Langkah 1')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: p.previous(3) })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('dua atau kurang langkah selesai: tidak ada tombol ringkasan', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(
      withPlan(tasks(['completed', 'completed', 'in_progress'])),
    );
    await renderScreen(<ProgressPanel />);
    const list = await screen.findByRole('list', { name: p.timeline });
    expect(within(list).queryByRole('button')).not.toBeInTheDocument();
  });

  it('nama tahap hanya tampil bila ada lebih dari satu tahap, di langkah pertama tiap tahap', async () => {
    source();
    api.getConversationProgress.mockResolvedValue({
      ...emptyProgress(),
      plan: {
        runId: RUN,
        phases: [
          { name: 'Persiapan', tasks: [{ content: 'A', status: 'completed' }] },
          {
            name: 'Pengerjaan',
            tasks: [
              { content: 'B', status: 'in_progress' },
              { content: 'C', status: 'pending' },
            ],
          },
        ],
      },
    });
    await renderScreen(<ProgressPanel />);
    const list = await screen.findByRole('list', { name: p.timeline });
    expect(within(list).getByText('Persiapan')).toBeInTheDocument();
    expect(within(list).getByText('Pengerjaan')).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('satu tahap: tanpa label tahap', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(withPlan(tasks(['in_progress', 'pending'])));
    await renderScreen(<ProgressPanel />);
    await screen.findByRole('list', { name: p.timeline });
    expect(screen.queryByText('Rencana')).not.toBeInTheDocument();
  });

  it('langkah live mengubah panel tanpa muat ulang: titik aktif berpindah dan tombol ringkasan muncul', async () => {
    source(RUN);
    api.getConversationProgress.mockResolvedValue(emptyProgress());
    await renderScreen(<ProgressPanel />);
    runs.track(RUN, CONV);
    act(() => {
      emit(`run:${RUN}`, { type: 'run.status', status: 'running' });
      emit(`run:${RUN}`, {
        type: 'todo.updated',
        phases: tasks(['in_progress', 'pending', 'pending']),
      });
    });
    const list = await screen.findByRole('list', { name: p.timeline });
    expect(within(list).getByText('Langkah 1').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );

    act(() => {
      emit(
        `run:${RUN}`,
        {
          type: 'todo.updated',
          phases: tasks(['completed', 'completed', 'completed', 'in_progress']),
        },
        2,
      );
    });
    await waitFor(() =>
      expect(within(list).getByText('Langkah 4').closest('li')).toHaveAttribute(
        'aria-current',
        'step',
      ),
    );
    expect(within(list).getByRole('button', { name: p.previous(1) })).toBeInTheDocument();
  });
});

describe('ProgressPanel: Output dan Digunakan', () => {
  it('kartu Output 2 kolom dengan judul dan jenis; klik gambar membuka pratinjau, diff membuka panel Diff', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(fixture('reload-complete').response);
    const user = userEvent.setup();
    await renderScreen(<ProgressPanel />);
    const outputs = await screen.findByRole('list', { name: p.sections.outputs });
    expect(outputs).toHaveClass('grid-cols-2');
    expect(within(outputs).getAllByRole('listitem')).toHaveLength(3);
    expect(within(outputs).getByText(p.kinds.image)).toBeInTheDocument();
    expect(within(outputs).getByText(p.kinds.file)).toBeInTheDocument();
    expect(within(outputs).getByText(p.kinds.diff)).toBeInTheDocument();
    expect(within(outputs).getByText(p.diffTitle(2))).toBeInTheDocument();

    await user.click(
      within(outputs).getByRole('button', { name: p.openOutput('login-form.png', p.kinds.image) }),
    );
    expect(await screen.findByRole('dialog', { name: 'login-form.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: p.lightbox.close }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(
      within(outputs).getByRole('button', { name: p.openOutput(p.diffTitle(2), p.kinds.diff) }),
    );
    expect(useUiStore.getState().rightPanelTab).toBe('diff');
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
  });

  it('Digunakan: unggahan (nama pertama + +N), skill, memori (judul saja), mesin dan model, alat, konektor', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(fixture('reload-complete').response);
    const user = userEvent.setup();
    await renderScreen(<ProgressPanel />);
    const used = await screen.findByLabelText(p.sections.used);
    expect(within(used).getByText('desain.png')).toBeInTheDocument();
    expect(within(used).getByText('+1')).toBeInTheDocument();
    expect(within(used).getByText('plan-progress, scope-guard')).toBeInTheDocument();
    expect(within(used).getByText('omp · coding-main')).toBeInTheDocument();
    expect(within(used).getByText('Web, Terminal, Berkas')).toBeInTheDocument();
    expect(within(used).getByText('github')).toBeInTheDocument();

    const memory = within(used).getByRole('button', { name: new RegExp(p.used.memoryRead(3)) });
    expect(memory).toHaveAttribute('aria-expanded', 'false');
    await user.click(memory);
    const list = within(used).getByRole('list', { name: p.used.memoryList });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Suka jawaban singkat')).toBeInTheDocument();
  });

  it('tanpa data penggunaan: bagian Digunakan tidak tampil; konektor hanya bila ada datanya', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(withPlan(tasks(['in_progress'])));
    await renderScreen(<ProgressPanel />);
    await screen.findByRole('list', { name: p.timeline });
    expect(screen.queryByText(p.sections.used)).not.toBeInTheDocument();
    expect(screen.queryByText(p.used.connectors)).not.toBeInTheDocument();
  });
});

describe('ProgressPanel: pohon tim Orca (P7)', () => {
  const TEAM_ID = uid();
  const WORKER_MEMBER = uid();
  const WORKER_RUN = uid();
  const LEAD_RUN = uid();

  it('percakapan milik tim: pohon Lead->tugas->Worker tampil menggantikan linimasa biasa', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(emptyProgress());
    api.getConversation.mockResolvedValue({
      id: CONV,
      title: 'Lead: tambah tes',
      surface: 'windows',
      projectId: 'proj-1',
      spaceId: null,
      teamId: TEAM_ID,
      pinned: false,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    api.getTeam.mockResolvedValue({
      id: TEAM_ID,
      projectId: 'proj-1',
      status: 'running',
      memberCount: 2,
      pendingApprovals: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      parentRunId: LEAD_RUN,
      prompt: 'Tambahkan tes untuk fungsi tambah.',
      limits: {
        maxWorkers: 1,
        maxReviewRounds: 2,
        teamTimeoutMinutes: 120,
        memberTimeoutMinutes: 30,
        stepsPerMember: 100,
        tokensPerTeam: 100_000,
        tokensPerMember: 40_000,
        inputTokensPerCall: 20_000,
        outputTokensPerCall: 8_000,
      },
      members: [
        {
          id: uid(),
          role: 'lead',
          status: 'completed',
          task: 'Tambahkan tes untuk fungsi tambah.',
          branch: null,
          runId: LEAD_RUN,
          conversationId: CONV,
          updatedAt: '2026-01-01T00:00:00.000Z',
          exitReason: null,
        },
        {
          id: WORKER_MEMBER,
          role: 'worker',
          status: 'running',
          task: 'Tambah tes matematika',
          branch: null,
          runId: WORKER_RUN,
          conversationId: uid(),
          updatedAt: '2026-01-01T00:00:00.000Z',
          exitReason: null,
        },
      ],
      assignments: [
        {
          id: uid(),
          teamId: TEAM_ID,
          workerMemberId: WORKER_MEMBER,
          title: 'Tambah tes matematika',
          prompt: 'Tambahkan tes untuk fungsi tambah.',
          acceptanceCriteria: 'Tes baru ada dan lulus.',
          status: 'running',
          attempt: 1,
          maxAttempts: 3,
          resultSummary: null,
          resultRef: null,
          reviewStatus: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      cancelRequestedAt: null,
      failureCode: null,
      finishedAt: null,
    });

    await renderScreen(<ProgressPanel />);

    expect(await screen.findByText('Lead')).toBeInTheDocument();
    expect(screen.getByText('Tambah tes matematika')).toBeInTheDocument();
    expect(screen.getByText(/Percobaan 1 dari 3/)).toBeInTheDocument();
    expect(screen.queryByText(p.noSteps)).not.toBeInTheDocument();
  });

  it('anggota Worker yang masih berjalan punya tombol hentikan; memanggil cancelTeamMember', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(emptyProgress());
    api.getConversation.mockResolvedValue({
      id: CONV,
      title: 'Lead: tambah tes',
      surface: 'windows',
      projectId: 'proj-1',
      spaceId: null,
      teamId: TEAM_ID,
      pinned: false,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    api.getTeam.mockResolvedValue({
      id: TEAM_ID,
      projectId: 'proj-1',
      status: 'running',
      memberCount: 2,
      pendingApprovals: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      parentRunId: LEAD_RUN,
      prompt: 'x',
      limits: {
        maxWorkers: 1,
        maxReviewRounds: 2,
        teamTimeoutMinutes: 120,
        memberTimeoutMinutes: 30,
        stepsPerMember: 100,
        tokensPerTeam: 100_000,
        tokensPerMember: 40_000,
        inputTokensPerCall: 20_000,
        outputTokensPerCall: 8_000,
      },
      members: [
        {
          id: WORKER_MEMBER,
          role: 'worker',
          status: 'running',
          task: 'Tugas',
          branch: null,
          runId: WORKER_RUN,
          conversationId: uid(),
          updatedAt: '2026-01-01T00:00:00.000Z',
          exitReason: null,
        },
      ],
      assignments: [
        {
          id: uid(),
          teamId: TEAM_ID,
          workerMemberId: WORKER_MEMBER,
          title: 'Tugas',
          prompt: 'x',
          acceptanceCriteria: 'y',
          status: 'running',
          attempt: 1,
          maxAttempts: 3,
          resultSummary: null,
          resultRef: null,
          reviewStatus: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      cancelRequestedAt: null,
      failureCode: null,
      finishedAt: null,
    });
    api.cancelTeamMember.mockResolvedValue({} as never);

    const user = userEvent.setup();
    await renderScreen(<ProgressPanel />);
    const stop = await screen.findByRole('button', { name: copy.chat.team.cancelMember });
    await user.click(stop);
    expect(api.cancelTeamMember).toHaveBeenCalledWith(TEAM_ID, WORKER_MEMBER);
  });

  it('tombol "Hentikan tim" memanggil cancelTeam; tidak muncul lagi setelah cancelRequestedAt terisi', async () => {
    source();
    api.getConversationProgress.mockResolvedValue(emptyProgress());
    api.getConversation.mockResolvedValue({
      id: CONV,
      title: 'Lead: x',
      surface: 'windows',
      projectId: 'proj-1',
      spaceId: null,
      teamId: TEAM_ID,
      pinned: false,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const base = {
      id: TEAM_ID,
      projectId: 'proj-1',
      status: 'running' as const,
      memberCount: 1,
      pendingApprovals: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      parentRunId: LEAD_RUN,
      prompt: 'x',
      limits: {
        maxWorkers: 1,
        maxReviewRounds: 2,
        teamTimeoutMinutes: 120,
        memberTimeoutMinutes: 30,
        stepsPerMember: 100,
        tokensPerTeam: 100_000,
        tokensPerMember: 40_000,
        inputTokensPerCall: 20_000,
        outputTokensPerCall: 8_000,
      },
      members: [],
      assignments: [],
      failureCode: null,
      finishedAt: null,
    };
    api.getTeam.mockResolvedValue({ ...base, cancelRequestedAt: null });
    api.cancelTeam.mockResolvedValue({ ...base, cancelRequestedAt: '2026-01-01T00:01:00.000Z' });

    const user = userEvent.setup();
    await renderScreen(<ProgressPanel />);
    const stop = await screen.findByRole('button', { name: copy.chat.team.cancel });
    await user.click(stop);
    expect(api.cancelTeam).toHaveBeenCalledWith(TEAM_ID);
  });
});
