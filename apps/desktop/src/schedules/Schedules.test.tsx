import type { Schedule } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { RUN_1, TS, run } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { SchedulesScreen } = await import('./SchedulesScreen');
const { ScheduleDetailScreen } = await import('./ScheduleDetailScreen');

const SCHEDULE = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: SCHEDULE,
    name: 'Berita AI',
    cron: '0 7 * * 1',
    timezone: 'Asia/Jakarta',
    prompt: 'Ringkas berita AI minggu ini',
    target: 'chat',
    agentRole: null,
    enabled: true,
    nextRunAt: '2026-10-26T00:00:00Z',
    conversationId: '0192f0c4-7a1b-7c2d-9e3f-4a5b6c7d8e90',
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

const parsed = {
  name: 'Berita AI mingguan',
  cron: '0 7 * * 1',
  timezone: 'Asia/Jakarta',
  prompt: 'Ringkas berita AI',
  target: 'chat' as const,
  agentRole: null,
  description: 'Setiap Senin 07.00 WIB',
  nextRuns: ['2026-10-26T00:00:00Z', '2026-11-02T00:00:00Z', '2026-11-09T00:00:00Z'] as [
    string,
    string,
    string,
  ],
};

beforeEach(() => {
  resetApi();
  api.listScheduleRuns.mockResolvedValue({ items: [], nextBefore: null });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('SchedulesScreen: tabel', () => {
  it('menampilkan kolom, jalan berikutnya dalam zona jadwal, dan status', async () => {
    api.listSchedules.mockResolvedValue([
      schedule(),
      schedule({ id: '0192f0c4-7a1b-7c2d-8e3f-000000000099', name: 'Mati', enabled: false }),
    ]);
    await renderScreen(<SchedulesScreen />, '/schedules');

    const table = await screen.findByRole('table', { name: copy.schedules.table });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      copy.schedules.columns.name,
      copy.schedules.columns.when,
      copy.schedules.columns.next,
      copy.schedules.columns.target,
      copy.schedules.columns.status,
    ]);
    const row = within(table).getByRole('link', { name: 'Berita AI' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('0 7 * * 1')).toBeInTheDocument();
    expect(within(row).getByRole('switch')).toBeChecked();
    const off = within(table).getByRole('link', { name: 'Mati' }).closest('tr') as HTMLElement;
    expect(within(off).getByRole('switch')).not.toBeChecked();
    expect(within(off).getByText(copy.schedules.never)).toBeInTheDocument();
  });

  it('kosong: kalimat apa yang bisa dilakukan dan satu tombol aksi', async () => {
    await renderScreen(<SchedulesScreen />, '/schedules');

    expect(await screen.findByText(copy.schedules.empty)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: copy.schedules.newSchedule })).toHaveLength(1);
  });

  it('error dengan Coba lagi, dan offline', async () => {
    api.listSchedules.mockRejectedValueOnce(new ApiProblem(500, 'x', 'x'));
    const user = userEvent.setup();
    const view = await renderScreen(<SchedulesScreen />, '/schedules');
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.server);

    api.listSchedules.mockResolvedValue([schedule()]);
    await user.click(screen.getByRole('button', { name: copy.states.retry }));
    expect(await screen.findByRole('link', { name: 'Berita AI' })).toBeInTheDocument();
    view.unmount();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listSchedules.mockRejectedValue(new ApiProblem(0, 'network', 'x'));
    await renderScreen(<SchedulesScreen />, '/schedules');
    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });

  it('sakelar mengaktifkan/menonaktifkan jadwal lewat server', async () => {
    api.listSchedules.mockResolvedValue([schedule()]);
    api.updateSchedule.mockResolvedValue(schedule({ enabled: false }));
    const user = userEvent.setup();
    await renderScreen(<SchedulesScreen />, '/schedules');

    await user.click(await screen.findByRole('switch'));

    expect(api.updateSchedule).toHaveBeenCalledWith(SCHEDULE, { enabled: false });
  });
});

describe('NewScheduleDialog: bahasa alami dengan konfirmasi', () => {
  it('baca teks, periksa hasil parse, ubah nama, lalu simpan', async () => {
    api.listSchedules.mockResolvedValue([schedule()]);
    api.parseSchedule.mockResolvedValue(parsed);
    api.createSchedule.mockResolvedValue(
      schedule({ id: '0192f0c4-7a1b-7c2d-8e3f-0000000000aa', name: 'Pagi AI' }),
    );
    const user = userEvent.setup();
    const { router } = await renderScreen(<SchedulesScreen />, '/schedules');

    await user.click(await screen.findByRole('button', { name: copy.schedules.newSchedule }));
    const dialog = await screen.findByRole('dialog', { name: copy.schedules.dialog.title });
    await user.type(
      within(dialog).getByLabelText(copy.schedules.dialog.text),
      'Setiap Senin 07.00 ringkas berita AI',
    );
    await user.click(within(dialog).getByRole('button', { name: copy.schedules.dialog.parse }));

    expect(api.parseSchedule).toHaveBeenCalledWith('Setiap Senin 07.00 ringkas berita AI');
    const check = await screen.findByRole('dialog', { name: copy.schedules.dialog.checkTitle });
    expect(within(check).getByText('Setiap Senin 07.00 WIB')).toBeInTheDocument();
    expect(within(check).getAllByRole('listitem')).toHaveLength(3);
    expect(api.createSchedule).not.toHaveBeenCalled();

    const name = within(check).getByLabelText(copy.schedules.dialog.name);
    await user.clear(name);
    await user.type(name, 'Pagi AI');
    await user.click(within(check).getByRole('button', { name: copy.schedules.dialog.save }));

    expect(api.createSchedule).toHaveBeenCalledWith({
      name: 'Pagi AI',
      cron: '0 7 * * 1',
      timezone: 'Asia/Jakarta',
      prompt: 'Ringkas berita AI',
      target: 'chat',
      agentRole: null,
      enabled: true,
    });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        '/schedules/0192f0c4-7a1b-7c2d-8e3f-0000000000aa',
      ),
    );
  });

  it('teks kosong ditolak lokal; teks yang tidak dipahami server menampilkan error dan tetap di langkah satu', async () => {
    api.listSchedules.mockResolvedValue([schedule()]);
    api.parseSchedule.mockRejectedValue(new ApiProblem(422, 'unparseable', 'x'));
    const user = userEvent.setup();
    await renderScreen(<SchedulesScreen />, '/schedules');

    await user.click(await screen.findByRole('button', { name: copy.schedules.newSchedule }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: copy.schedules.dialog.parse }));
    expect(within(dialog).getByText(copy.schedules.dialog.emptyText)).toBeInTheDocument();
    expect(api.parseSchedule).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(copy.schedules.dialog.text), 'asdf');
    await user.click(within(dialog).getByRole('button', { name: copy.schedules.dialog.parse }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(copy.errors.unprocessable);
    expect(within(dialog).getByLabelText(copy.schedules.dialog.text)).toHaveValue('asdf');
  });

  it('Ubah teks kembali ke langkah satu tanpa menyimpan apa pun', async () => {
    api.listSchedules.mockResolvedValue([schedule()]);
    api.parseSchedule.mockResolvedValue(parsed);
    const user = userEvent.setup();
    await renderScreen(<SchedulesScreen />, '/schedules');

    await user.click(await screen.findByRole('button', { name: copy.schedules.newSchedule }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(copy.schedules.dialog.text), 'x');
    await user.click(within(dialog).getByRole('button', { name: copy.schedules.dialog.parse }));
    await user.click(await screen.findByRole('button', { name: copy.schedules.dialog.edit }));

    expect(screen.getByLabelText(copy.schedules.dialog.text)).toHaveValue('x');
    expect(api.createSchedule).not.toHaveBeenCalled();
  });
});

describe('ScheduleDetailScreen: riwayat dan aksi', () => {
  it('menampilkan riwayat run dengan status, lalu Jalankan sekarang', async () => {
    api.listSchedules.mockResolvedValue([schedule()]);
    api.listScheduleRuns.mockResolvedValue({
      items: [
        {
          id: '0192f0c4-7a1b-7c2d-8e3f-0000000000b1',
          scheduleId: SCHEDULE,
          runId: RUN_1,
          status: 'succeeded',
          startedAt: '2026-10-19T00:00:00Z',
          finishedAt: '2026-10-19T00:01:00Z',
        },
        {
          id: '0192f0c4-7a1b-7c2d-8e3f-0000000000b2',
          scheduleId: SCHEDULE,
          runId: null,
          status: 'missed',
          startedAt: '2026-10-12T00:00:00Z',
          finishedAt: null,
        },
      ],
      nextBefore: null,
    });
    api.runScheduleNow.mockResolvedValue(run());
    const user = userEvent.setup();
    await renderScreen(<ScheduleDetailScreen scheduleId={SCHEDULE} />, `/schedules/${SCHEDULE}`);

    const history = await screen.findByRole('table', { name: copy.schedules.detail.history });
    expect(within(history).getByText(copy.schedules.runStatus.succeeded)).toBeInTheDocument();
    expect(within(history).getByText(copy.schedules.runStatus.missed)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: copy.schedules.detail.openResult }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: copy.schedules.detail.runNow }));
    expect(api.runScheduleNow).toHaveBeenCalledWith(SCHEDULE);
    expect(await screen.findByText(copy.schedules.detail.runStarted)).toBeInTheDocument();
  });

  it('riwayat kosong punya pesan sendiri', async () => {
    api.listSchedules.mockResolvedValue([schedule()]);
    await renderScreen(<ScheduleDetailScreen scheduleId={SCHEDULE} />, `/schedules/${SCHEDULE}`);

    expect(await screen.findByText(copy.schedules.detail.historyEmpty)).toBeInTheDocument();
  });

  it('hapus meminta konfirmasi, lalu menghapus dan kembali ke tabel', async () => {
    api.listSchedules.mockResolvedValue([schedule()]);
    api.deleteSchedule.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { router } = await renderScreen(
      <ScheduleDetailScreen scheduleId={SCHEDULE} />,
      `/schedules/${SCHEDULE}`,
    );

    await user.click(await screen.findByRole('button', { name: copy.schedules.detail.delete }));
    expect(api.deleteSchedule).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: copy.schedules.detail.deleteYes }));

    expect(api.deleteSchedule).toHaveBeenCalledWith(SCHEDULE);
    await waitFor(() => expect(router.state.location.pathname).toBe('/schedules'));
  });

  it('jadwal yang tidak ada menampilkan keadaan tidak ditemukan', async () => {
    api.listSchedules.mockResolvedValue([]);
    await renderScreen(<ScheduleDetailScreen scheduleId={SCHEDULE} />, `/schedules/${SCHEDULE}`);

    expect(await screen.findByText(copy.errors.notFound)).toBeInTheDocument();
  });
});
