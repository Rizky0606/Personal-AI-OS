import type { AgentProposal } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { TS } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { TaskProposals, ScheduleProposals } = await import('./AgentProposals');

const a = copy.agentProposals;
const PROJECT = '0192f0c4-7a1b-7c2d-8e3f-0000000000f1';

type TaskItem = Extract<AgentProposal, { kind: 'task' }>;
type ScheduleItem = Extract<AgentProposal, { kind: 'schedule' }>;

const common = {
  status: 'pending' as const,
  agent: 'omp' as const,
  reason: 'Tes login sering gagal di CI.',
  afterWeb: false,
  conversationId: null,
  runId: null,
  resultId: null,
  createdAt: TS,
  decidedAt: null,
};

function taskProposal(over: Partial<TaskItem> = {}): TaskItem {
  return {
    ...common,
    id: '0192f0c4-7a1b-7c2d-8e3f-0000000000a1',
    kind: 'task',
    projectId: PROJECT,
    task: { title: 'Perbaiki tes login', body: 'Tes **login** gagal karena token kedaluwarsa.' },
    ...over,
  };
}

function scheduleProposal(over: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    ...common,
    id: '0192f0c4-7a1b-7c2d-8e3f-0000000000b1',
    kind: 'schedule',
    agent: 'hermes',
    projectId: null,
    reason: 'Pemilik minta ringkasan berita tiap pekan.',
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
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('TaskProposals', () => {
  it('tanpa usulan: tidak tampil; daftar diminta per project dan jenis kartu', async () => {
    await renderScreen(<TaskProposals projectId={PROJECT} />);
    await waitFor(() =>
      expect(api.listAgentProposals).toHaveBeenCalledWith({ kind: 'task', projectId: PROJECT }),
    );
    expect(screen.queryByText(a.task.intro)).not.toBeInTheDocument();
  });

  it('menampilkan usulan sebagai teks biasa dengan alasan dan agent; Tambah ke Backlog dan Tolak memanggil API', async () => {
    const user = userEvent.setup();
    const first = taskProposal();
    const second = taskProposal({
      id: '0192f0c4-7a1b-7c2d-8e3f-0000000000a2',
      task: { title: 'Tulis dokumen API', body: '' },
    });
    api.listAgentProposals.mockResolvedValue([first, second]);
    api.approveAgentProposal.mockResolvedValue({ ...first, status: 'approved' });
    api.rejectAgentProposal.mockResolvedValue({ ...second, status: 'rejected' });
    await renderScreen(<TaskProposals projectId={PROJECT} />);

    expect(await screen.findByText(a.task.title(2))).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: a.task.list })).getAllByRole('listitem');
    expect(within(rows[0]!).getByText(first.task.body)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(a.reason(first.reason))).toBeInTheDocument();
    expect(within(rows[0]!).getByText(a.agents.omp)).toBeInTheDocument();
    expect(screen.queryByText(a.afterWeb)).not.toBeInTheDocument();

    await user.click(within(rows[0]!).getByRole('button', { name: a.task.approve }));
    expect(api.approveAgentProposal).toHaveBeenCalledWith(first.id, {});

    await user.click(await within(rows[1]!).findByRole('button', { name: a.reject }));
    expect(api.rejectAgentProposal).toHaveBeenCalledWith(second.id);
  });

  it('Ubah lalu tambah mengirim judul dan deskripsi hasil ubahan', async () => {
    const user = userEvent.setup();
    const item = taskProposal();
    api.listAgentProposals.mockResolvedValue([item]);
    api.approveAgentProposal.mockResolvedValue({ ...item, status: 'approved' });
    await renderScreen(<TaskProposals projectId={PROJECT} />);

    await user.click(await screen.findByRole('button', { name: a.task.editApprove }));
    const title = screen.getByRole('textbox', { name: a.task.titleLabel });
    await user.clear(title);
    await user.type(title, 'Perbaiki token tes login');
    const body = screen.getByRole('textbox', { name: a.task.bodyLabel });
    await user.clear(body);
    await user.type(body, 'Perpanjang masa token di fixture.');
    await user.click(screen.getByRole('button', { name: a.task.approve }));

    expect(api.approveAgentProposal).toHaveBeenCalledWith(item.id, {
      task: { title: 'Perbaiki token tes login', body: 'Perpanjang masa token di fixture.' },
    });
  });

  it('afterWeb: peringatan web tampil', async () => {
    api.listAgentProposals.mockResolvedValue([taskProposal({ afterWeb: true })]);
    await renderScreen(<TaskProposals projectId={PROJECT} />);
    expect(await screen.findByText(a.afterWeb)).toBeInTheDocument();
  });

  it('409: pesan sudah diputuskan tampil di baris dan daftar dimuat ulang', async () => {
    const user = userEvent.setup();
    const item = taskProposal();
    api.listAgentProposals.mockResolvedValue([item]);
    api.approveAgentProposal.mockRejectedValue(
      new ApiProblem(409, 'proposal_decided', 'Sudah diputuskan.'),
    );
    await renderScreen(<TaskProposals projectId={PROJECT} />);

    await user.click(await screen.findByRole('button', { name: a.task.approve }));
    expect(await screen.findByText(a.decided)).toBeInTheDocument();
    await waitFor(() => expect(api.listAgentProposals).toHaveBeenCalledTimes(2));
  });

  it('offline: tombol aksi nonaktif', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listAgentProposals.mockResolvedValue([taskProposal()]);
    await renderScreen(<TaskProposals projectId={PROJECT} />);
    expect(await screen.findByRole('button', { name: a.task.approve })).toBeDisabled();
    expect(screen.getByRole('button', { name: a.reject })).toBeDisabled();
  });
});

describe('ScheduleProposals', () => {
  it('tanpa usulan: tidak tampil', async () => {
    await renderScreen(<ScheduleProposals />);
    await waitFor(() => expect(api.listAgentProposals).toHaveBeenCalledWith({ kind: 'schedule' }));
    expect(screen.queryByText(a.schedule.intro)).not.toBeInTheDocument();
  });

  it('menampilkan jadwal; Setujui mengirim enabled; sakelar mati mengirim enabled false', async () => {
    const user = userEvent.setup();
    const item = scheduleProposal({ afterWeb: true });
    api.listAgentProposals.mockResolvedValue([item]);
    api.approveAgentProposal.mockRejectedValueOnce(new ApiProblem(500, 'x', 'Server bermasalah.'));
    api.approveAgentProposal.mockResolvedValue({ ...item, status: 'approved' });
    await renderScreen(<ScheduleProposals />);

    expect(await screen.findByText(a.schedule.title(1))).toBeInTheDocument();
    expect(
      screen.getByText(a.schedule.when(item.description, '0 7 * * 1', 'Asia/Jakarta')),
    ).toBeInTheDocument();
    expect(screen.getByText(a.schedule.target('Chat'))).toBeInTheDocument();
    expect(screen.getByText(a.agents.hermes)).toBeInTheDocument();
    expect(screen.getByText(a.afterWeb)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: a.schedule.approve }));
    expect(api.approveAgentProposal).toHaveBeenCalledWith(item.id, { schedule: { enabled: true } });
    expect(await screen.findByText(copy.errors.server)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: a.schedule.enable }));
    await user.click(screen.getByRole('button', { name: a.schedule.approve }));
    expect(api.approveAgentProposal).toHaveBeenLastCalledWith(item.id, {
      schedule: { enabled: false },
    });
  });

  it('Ubah lalu setujui mengirim isian ubahan; cron ditolak server tampil di baris', async () => {
    const user = userEvent.setup();
    const item = scheduleProposal();
    api.listAgentProposals.mockResolvedValue([item]);
    api.approveAgentProposal.mockRejectedValue(new ApiProblem(400, 'invalid_cron', 'x'));
    await renderScreen(<ScheduleProposals />);

    await user.click(await screen.findByRole('button', { name: a.schedule.editApprove }));
    const cron = screen.getByRole('textbox', { name: a.schedule.cronLabel });
    await user.clear(cron);
    await user.type(cron, '0 8 * * 1');
    await user.click(screen.getByRole('button', { name: a.schedule.targets.research }));
    await user.click(screen.getByRole('button', { name: a.schedule.approve }));

    expect(api.approveAgentProposal).toHaveBeenCalledWith(item.id, {
      schedule: {
        name: 'Ringkasan berita',
        cron: '0 8 * * 1',
        timezone: 'Asia/Jakarta',
        prompt: 'Ringkas berita teknologi minggu ini.',
        target: 'research',
        enabled: true,
      },
    });
    expect(await screen.findByText(a.invalidCron)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: a.schedule.cronLabel })).toHaveValue('0 8 * * 1');
  });

  it('Tolak memanggil API', async () => {
    const user = userEvent.setup();
    const item = scheduleProposal();
    api.listAgentProposals.mockResolvedValue([item]);
    api.rejectAgentProposal.mockResolvedValue({ ...item, status: 'rejected' });
    await renderScreen(<ScheduleProposals />);
    await user.click(await screen.findByRole('button', { name: a.reject }));
    expect(api.rejectAgentProposal).toHaveBeenCalledWith(item.id);
  });
});
