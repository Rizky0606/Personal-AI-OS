import type { AgentProposal } from '@aios/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { TS } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { AgentProposalCards } = await import('./AgentProposalCards');

const t = copy.chat.agentProposal;
const a = copy.agentProposals;
const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f10';
const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f11';
const OTHER_RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f12';
const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f13';

type TaskItem = Extract<AgentProposal, { kind: 'task' }>;
type ScheduleItem = Extract<AgentProposal, { kind: 'schedule' }>;

const common = {
  status: 'pending' as const,
  agent: 'omp' as const,
  reason: 'Tes login sering gagal di CI.',
  afterWeb: false,
  conversationId: CONV,
  runId: RUN,
  resultId: null,
  createdAt: TS,
  decidedAt: null,
};

function taskProposal(over: Partial<TaskItem> = {}): TaskItem {
  return {
    ...common,
    id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f01',
    kind: 'task',
    projectId: PROJECT,
    task: { title: 'Perbaiki tes login', body: 'Token kedaluwarsa.' },
    ...over,
  };
}

function scheduleProposal(over: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    ...common,
    id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8f02',
    kind: 'schedule',
    agent: 'hermes',
    projectId: null,
    schedule: {
      name: 'Ringkasan berita',
      cron: '0 7 * * 1',
      timezone: 'Asia/Jakarta',
      prompt: 'Ringkas berita teknologi minggu ini.',
      target: 'chat',
    },
    description: 'Setiap Senin 07.00 WIB',
    ...over,
  };
}

beforeEach(() => {
  resetApi();
  useUiStore.setState({ activeProjectId: null });
});

describe('kartu usulan agent di bawah jawaban', () => {
  it('menampilkan usulan kartu dan jadwal dari run itu, lengkap dengan status', async () => {
    api.listAgentProposals.mockResolvedValue([
      taskProposal(),
      scheduleProposal({ status: 'approved' }),
    ]);
    await renderScreen(<AgentProposalCards conversationId={CONV} runId={RUN} />);

    expect(await screen.findByText(t.cardTask('Perbaiki tes login'))).toBeInTheDocument();
    expect(screen.getByText(t.cardSchedule('Ringkasan berita'))).toBeInTheDocument();
    expect(screen.getByText(t.status.pending)).toBeInTheDocument();
    expect(screen.getByText(t.status.approved)).toBeInTheDocument();
    expect(api.listAgentProposals).toHaveBeenCalledWith({ status: 'all', conversationId: CONV });
    expect(screen.queryByRole('button', { name: a.task.approve })).not.toBeInTheDocument();
  });

  it('Tinjau usulan kartu membuka papan kanban project itu; usulan jadwal membuka layar Jadwal', async () => {
    const user = userEvent.setup();
    api.listAgentProposals.mockResolvedValue([taskProposal()]);
    const task = await renderScreen(<AgentProposalCards conversationId={CONV} runId={RUN} />);
    await user.click(
      await screen.findByRole('button', { name: t.reviewLabel('Perbaiki tes login') }),
    );
    expect(useUiStore.getState().activeProjectId).toBe(PROJECT);
    expect(task.router.state.location.pathname).toBe('/kanban');
    task.unmount();

    api.listAgentProposals.mockResolvedValue([scheduleProposal()]);
    const schedule = await renderScreen(<AgentProposalCards conversationId={CONV} runId={RUN} />);
    await user.click(
      await screen.findByRole('button', { name: t.reviewLabel('Ringkasan berita') }),
    );
    expect(schedule.router.state.location.pathname).toBe('/schedules');
  });

  it('peringatan web tampil bila agent membaca halaman web sebelum mengusulkan', async () => {
    api.listAgentProposals.mockResolvedValue([taskProposal({ afterWeb: true })]);
    await renderScreen(<AgentProposalCards conversationId={CONV} runId={RUN} />);
    expect(await screen.findByText(a.afterWeb)).toBeInTheDocument();
  });

  it('run lain atau pesan tanpa run tidak merender apa pun', async () => {
    api.listAgentProposals.mockResolvedValue([taskProposal({ runId: OTHER_RUN })]);
    const other = await renderScreen(<AgentProposalCards conversationId={CONV} runId={RUN} />);
    await vi.waitFor(() => expect(api.listAgentProposals).toHaveBeenCalled());
    expect(other.container.querySelector('ul')).toBeNull();
    other.unmount();

    api.listAgentProposals.mockResolvedValue([taskProposal()]);
    const noRun = await renderScreen(<AgentProposalCards conversationId={CONV} runId={null} />);
    expect(noRun.container.querySelector('ul')).toBeNull();
    expect(screen.queryByText(/mengusulkan/)).not.toBeInTheDocument();
  });
});
