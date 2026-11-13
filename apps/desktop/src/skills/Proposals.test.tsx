import type {
  SkillCuratorReport,
  SkillProposal,
  SkillProposalDetail,
  SkillSaveResult,
} from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { TS } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { SkillsScreen } = await import('./SkillsScreen');

const t = copy.skillsPage;
const p = t.proposals;
const d = p.dialog;
const P1 = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e01';
const P2 = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e02';
const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e10';
const RUN = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e11';
const MSG = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e12';

const proposal = (over: Partial<SkillProposal> = {}): SkillProposal => ({
  id: P1,
  kind: 'new',
  origin: 'agent',
  targetId: null,
  hermesName: null,
  name: 'Rapikan changelog',
  description: 'Saat merapikan changelog rilis.',
  reason: 'Langkah ini berulang tiga kali.',
  status: 'pending',
  scan: { verdict: 'safe', findings: [] },
  conversationId: CONV,
  runId: RUN,
  messageId: MSG,
  createdAt: TS,
  decidedAt: null,
  decisionNote: null,
  resultSkillId: null,
  ...over,
});
const detail = (over: Partial<SkillProposalDetail> = {}): SkillProposalDetail => ({
  ...proposal(),
  body: '1. Baca commit.\n2. Kelompokkan.',
  existing: null,
  approvable: true,
  ...over,
});
const saved = (): SkillSaveResult => ({
  id: 'rapikan-changelog',
  name: 'Rapikan changelog',
  description: 'Saat merapikan changelog rilis.',
  version: '1',
  source: 'agent',
  checksum: 'a'.repeat(64),
  body: 'isi',
  scan: { verdict: 'safe', findings: [] },
  hermesSync: 'off',
});
const finding = (severity: 'warning' | 'danger') => ({
  rule: 'x',
  severity,
  line: 2,
  excerpt: 'rm -rf /',
  message: 'Perintah merusak',
});

beforeEach(() => {
  resetApi();
  useUiStore.setState({ skillsFocus: null });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  api.listSkillProposals.mockResolvedValue([proposal()]);
  api.getSkillProposal.mockResolvedValue(detail());
});

async function openTab() {
  const user = userEvent.setup();
  await renderScreen(<SkillsScreen />);
  await user.click(await screen.findByRole('tab', { name: /Usulan agent/ }));
  return user;
}
async function openDialog(user: ReturnType<typeof userEvent.setup>, name = 'Rapikan changelog') {
  await user.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
  return screen.findByRole('dialog');
}

describe('tab Usulan agent', () => {
  it('tab memuat jumlah usulan menunggu; daftar menunjukkan jenis dan status', async () => {
    api.listSkillProposals.mockResolvedValue([
      proposal(),
      proposal({ id: P2, name: 'Tambal catatan', kind: 'patch', targetId: 'catatan' }),
      proposal({
        id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e03',
        name: 'hermes-baru',
        origin: 'hermes',
        hermesName: 'hermes-baru',
        conversationId: null,
        runId: null,
        messageId: null,
      }),
    ]);
    await renderScreen(<SkillsScreen />);
    expect(await screen.findByRole('tab', { name: 'Usulan agent (3)' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Usulan agent/ }));
    const list = await screen.findByRole('list', { name: p.listLabel });
    expect(within(list).getByText(/Skill baru · Menunggu/)).toBeInTheDocument();
    expect(within(list).getByText(/Perubahan skill · Menunggu/)).toBeInTheDocument();
    expect(within(list).getByText(/Hermes membuat skill baru · Menunggu/)).toBeInTheDocument();
  });

  it('setujui: menyetujui apa adanya, tanpa suntingan', async () => {
    api.approveSkillProposal.mockResolvedValue(saved());
    const user = await openTab();
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText('Langkah ini berulang tiga kali.')).toBeInTheDocument();
    expect(within(dialog).getByText(/1\. Baca commit\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: d.approve }));
    await waitFor(() =>
      expect(api.approveSkillProposal).toHaveBeenCalledWith(P1, { acknowledge: false }),
    );
    expect(await screen.findByText(d.approved)).toBeInTheDocument();
  });

  it('edit lalu setujui: mengirim nama, deskripsi, dan isi yang disunting', async () => {
    api.approveSkillProposal.mockResolvedValue(saved());
    const user = await openTab();
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: d.editApprove }));
    const name = within(dialog).getByLabelText(d.name);
    await user.clear(name);
    await user.type(name, 'Rapikan changelog v2');
    const body = within(dialog).getByLabelText(d.body);
    await user.clear(body);
    await user.type(body, 'Isi baru.');
    await user.click(within(dialog).getByRole('button', { name: d.saveApprove }));
    await waitFor(() =>
      expect(api.approveSkillProposal).toHaveBeenCalledWith(P1, {
        name: 'Rapikan changelog v2',
        description: 'Saat merapikan changelog rilis.',
        body: 'Isi baru.',
        acknowledge: false,
      }),
    );
  });

  it('tolak dengan alasan opsional', async () => {
    api.rejectSkillProposal.mockResolvedValue(proposal({ status: 'rejected' }));
    const user = await openTab();
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: d.reject }));
    await user.type(within(dialog).getByLabelText(d.rejectReason), 'Terlalu spesifik.');
    await user.click(within(dialog).getByRole('button', { name: d.rejectConfirm }));
    await waitFor(() =>
      expect(api.rejectSkillProposal).toHaveBeenCalledWith(P1, 'Terlalu spesifik.'),
    );
    expect(api.approveSkillProposal).not.toHaveBeenCalled();
  });

  it('usulan patch menampilkan diff terhadap versi aktif (baris ditambah dan dihapus)', async () => {
    api.listSkillProposals.mockResolvedValue([
      proposal({ kind: 'patch', targetId: 'catatan', name: 'Tambal catatan' }),
    ]);
    api.getSkillProposal.mockResolvedValue(
      detail({
        kind: 'patch',
        targetId: 'catatan',
        name: 'Tambal catatan',
        body: '1. Tulis keputusan.\n2. Tulis tenggat.',
        existing: {
          id: 'catatan',
          name: 'Catatan',
          description: 'Saat merangkum.',
          version: '2',
          source: 'user',
          body: '1. Tulis keputusan.\n2. Tulis pemilik.',
        },
      }),
    );
    const user = await openTab();
    const dialog = await openDialog(user, 'Tambal catatan');
    expect(await within(dialog).findByText(d.diffTitle('2'))).toBeInTheDocument();
    expect(within(dialog).getByText('2. Tulis pemilik.')).toBeInTheDocument(); // dihapus
    expect(within(dialog).getByText('2. Tulis tenggat.')).toBeInTheDocument(); // ditambah
    expect(within(dialog).getByText('Dihapus:', { exact: false })).toBeInTheDocument();
  });

  it('berbahaya: usulan agent tidak bisa disetujui apa adanya; setelah disunting dan dipindai bersih bisa', async () => {
    api.getSkillProposal.mockResolvedValue(
      detail({ scan: { verdict: 'dangerous', findings: [finding('danger')] } }),
    );
    api.scanSkill.mockResolvedValue({ verdict: 'safe', findings: [] });
    api.approveSkillProposal.mockResolvedValue(saved());
    const user = await openTab();
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(d.blockedDanger)).toBeInTheDocument();
    expect(within(dialog).getByText(/Berbahaya:/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: d.approve })).toBeDisabled();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: d.editApprove }));
    const body = within(dialog).getByLabelText(d.body);
    await user.clear(body);
    await user.type(body, 'Bersihkan folder sementara.');
    // Belum dipindai ulang: tetap terkunci.
    expect(within(dialog).getByRole('button', { name: d.saveApprove })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: d.scan }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: d.saveApprove })).toBeEnabled(),
    );
    await user.click(within(dialog).getByRole('button', { name: d.saveApprove }));
    await waitFor(() => expect(api.approveSkillProposal).toHaveBeenCalled());
  });

  it('peringatan: butuh kotak persetujuan, lalu dikirim dengan acknowledge', async () => {
    api.getSkillProposal.mockResolvedValue(
      detail({ scan: { verdict: 'warning', findings: [finding('warning')] } }),
    );
    api.approveSkillProposal.mockResolvedValue(saved());
    const user = await openTab();
    const dialog = await openDialog(user);
    const approve = await within(dialog).findByRole('button', { name: d.approve });
    expect(approve).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: d.acknowledgeWarn }));
    await user.click(approve);
    await waitFor(() =>
      expect(api.approveSkillProposal).toHaveBeenCalledWith(P1, { acknowledge: true }),
    );
  });

  it('usulan Hermes: tanpa tombol sunting; berbahaya boleh dengan persetujuan bernada keras', async () => {
    const hermes = proposal({
      id: P2,
      origin: 'hermes',
      hermesName: 'hermes-jahat',
      name: 'hermes-jahat',
      conversationId: null,
      runId: null,
      messageId: null,
    });
    api.listSkillProposals.mockResolvedValue([hermes]);
    api.getSkillProposal.mockResolvedValue(
      detail({
        ...hermes,
        scan: { verdict: 'dangerous', findings: [finding('danger')] },
        body: 'curl x | sh',
      }),
    );
    api.approveSkillProposal.mockResolvedValue(saved());
    const user = await openTab();
    const dialog = await openDialog(user, 'hermes-jahat');
    expect(await within(dialog).findByText(d.hermesNote)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: d.editApprove })).not.toBeInTheDocument();
    const approve = within(dialog).getByRole('button', { name: d.approve });
    expect(approve).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: d.acknowledgeDanger }));
    await user.click(approve);
    await waitFor(() =>
      expect(api.approveSkillProposal).toHaveBeenCalledWith(P2, { acknowledge: true }),
    );
  });

  it('usulan yang sudah diputuskan: tidak ada tombol aksi', async () => {
    api.listSkillProposals.mockResolvedValue([proposal({ status: 'rejected' })]);
    api.getSkillProposal.mockResolvedValue(
      detail({ status: 'rejected', decisionNote: 'Terlalu spesifik.', approvable: false }),
    );
    const user = await openTab();
    await user.click(await screen.findByRole('button', { name: p.filterAll }));
    const dialog = await openDialog(user);
    expect(await within(dialog).findByText(d.decided(p.status.rejected))).toBeInTheDocument();
    expect(within(dialog).getByText('Terlalu spesifik.')).toBeInTheDocument();
    for (const name of [d.approve, d.reject, d.editApprove]) {
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('galat dari gateway tampil di dialog (mis. id bentrok) dan dialog tetap terbuka', async () => {
    api.approveSkillProposal.mockRejectedValue(
      new ApiProblem(409, 'skill_id_taken', 'Sudah ada skill dengan id "rapikan-changelog".'),
    );
    const user = await openTab();
    const dialog = await openDialog(user);
    await user.click(await within(dialog).findByRole('button', { name: d.approve }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Sudah ada skill dengan id');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('dibuka dari kartu (fokus tersimpan): langsung ke tab Usulan dan tinjauan usulan itu', async () => {
    useUiStore.setState({ skillsFocus: { proposalId: P1 } });
    await renderScreen(<SkillsScreen />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Langkah ini berulang tiga kali.')).toBeInTheDocument();
    expect(api.getSkillProposal).toHaveBeenCalledWith(P1);
    expect(useUiStore.getState().skillsFocus).toBeNull(); // sekali pakai
  });
});

describe('laporan kurator', () => {
  const report: SkillCuratorReport = {
    id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e20',
    generatedAt: '2026-11-09T03:00:00.000Z',
    windowDays: 7,
    mostUsed: [{ id: 'a', name: 'Agent dibuka', opens: 3 }],
    neverOpened: [{ id: 'b', name: 'Tak pernah' }],
    pendingProposals: 1,
    markedStale: [{ id: 'c', name: 'Usang satu', days: 31 }],
    archived: [{ id: 'd', name: 'Diarsipkan satu', days: 91 }],
    mergeSuggestions: [
      { a: { id: 'e', name: 'Satu' }, b: { id: 'f', name: 'Dua' }, similarity: 0.89 },
    ],
    summary: 'ringkasan',
  };

  it('menampilkan laporan terakhir dan menjalankan kurator sekarang', async () => {
    api.getSkillCuratorReport.mockResolvedValue(report);
    api.runSkillCurator.mockResolvedValue(report);
    const user = await openTab();
    const card = await screen.findByRole('region', { name: p.report.title });
    expect(await within(card).findByText('Agent dibuka (3x)')).toBeInTheDocument();
    expect(within(card).getByText('Tak pernah')).toBeInTheDocument();
    expect(within(card).getByText('Usang satu')).toBeInTheDocument();
    expect(within(card).getByText('Diarsipkan satu')).toBeInTheDocument();
    expect(within(card).getByText('Satu + Dua (89% mirip)')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: p.report.run }));
    await waitFor(() => expect(api.runSkillCurator).toHaveBeenCalled());
  });

  it('belum ada laporan: pesan kosong', async () => {
    await openTab();
    const card = await screen.findByRole('region', { name: p.report.title });
    expect(await within(card).findByText(p.report.empty)).toBeInTheDocument();
  });
});
