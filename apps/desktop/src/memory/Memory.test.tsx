import type { Memory, MemoryProposal } from '@aios/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { TS } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { MemorySection } = await import('./MemorySection');
const { RememberDialog } = await import('./RememberDialog');

const m = copy.memory;
const memory = (over: Partial<Memory> = {}): Memory => ({
  id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f',
  text: 'Saya memakai Windows 11.',
  enabled: true,
  pinned: false,
  source: 'owner',
  origin: null,
  createdAt: TS,
  updatedAt: TS,
  ...over,
});
const CONVERSATION = '0192f0c4-7a1b-7c2d-8e3f-000000000001';
const proposal = (over: Partial<MemoryProposal> = {}): MemoryProposal => ({
  id: '0192f0c4-7a1b-7c2d-8e3f-0000000000aa',
  kind: 'add',
  status: 'pending',
  text: 'Pemilik tinggal di Bandung.',
  evidence: 'saya tinggal di Bandung',
  targetMemoryId: null,
  targetText: null,
  previousText: null,
  resultMemoryId: null,
  conversationId: CONVERSATION,
  messageId: null,
  runId: null,
  model: 'router-fast',
  source: 'extraction',
  agent: null,
  afterWeb: false,
  createdAt: TS,
  decidedAt: null,
  ...over,
});

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('MemorySection', () => {
  it('kosong: pesan ajakan; menambah fakta memanggil API dengan teks yang dirapikan', async () => {
    const user = userEvent.setup();
    api.createMemory.mockResolvedValue(memory());
    await renderScreen(<MemorySection />);
    expect(await screen.findByText(m.empty)).toBeInTheDocument();

    await user.type(
      screen.getByRole('textbox', { name: m.addLabel }),
      '  Saya memakai Windows 11.  ',
    );
    await user.click(screen.getByRole('button', { name: m.add }));

    expect(api.createMemory).toHaveBeenCalledWith('Saya memakai Windows 11.');
    await waitFor(() => expect(screen.getByRole('textbox', { name: m.addLabel })).toHaveValue(''));
  });

  it('kosong: tombol aksi memindahkan fokus ke kolom tulis memori', async () => {
    const user = userEvent.setup();
    await renderScreen(<MemorySection />);
    await user.click(await screen.findByRole('button', { name: m.addAction }));

    expect(screen.getByRole('textbox', { name: m.addLabel })).toHaveFocus();
  });

  it('daftar: sakelar menonaktifkan, Ubah menyimpan teks baru, Hapus minta konfirmasi', async () => {
    const user = userEvent.setup();
    const item = memory();
    api.listMemories.mockResolvedValue([item]);
    api.updateMemory.mockResolvedValue(item);
    api.deleteMemory.mockResolvedValue(undefined);
    await renderScreen(<MemorySection />);

    const list = await screen.findByRole('list', { name: m.listLabel });
    await user.click(within(list).getByRole('switch', { name: m.toggle(item.text) }));
    expect(api.updateMemory).toHaveBeenCalledWith(item.id, { enabled: false });

    await user.click(within(list).getByRole('button', { name: m.edit }));
    const editor = within(list).getByRole('textbox', { name: m.editLabel });
    await user.clear(editor);
    await user.type(editor, 'Saya memakai Windows 11 Home.');
    await user.click(within(list).getByRole('button', { name: m.saveEdit }));
    expect(api.updateMemory).toHaveBeenCalledWith(item.id, {
      text: 'Saya memakai Windows 11 Home.',
    });

    await user.click(await within(list).findByRole('button', { name: m.delete }));
    const dialog = await screen.findByRole('dialog', { name: m.deleteTitle });
    await user.click(within(dialog).getByRole('button', { name: m.delete }));
    expect(api.deleteMemory).toHaveBeenCalledWith(item.id);
  });

  it('memori nonaktif ditandai dicoret dan sakelarnya mati', async () => {
    api.listMemories.mockResolvedValue([memory({ enabled: false })]);
    await renderScreen(<MemorySection />);
    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Saya memakai Windows 11.')).toHaveClass('line-through');
  });

  it('sematkan: tombol mengirim pinned, memori tersemat berlencana dan tombolnya melepas sematan', async () => {
    const user = userEvent.setup();
    const item = memory();
    api.listMemories.mockResolvedValue([item]);
    api.updateMemory.mockResolvedValue({ ...item, pinned: true });
    const view = await renderScreen(<MemorySection />);
    const list = await screen.findByRole('list', { name: m.listLabel });
    expect(within(list).queryByText(m.pinnedBadge)).not.toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: m.pin }));
    expect(api.updateMemory).toHaveBeenCalledWith(item.id, { pinned: true });
    view.unmount();

    api.listMemories.mockResolvedValue([memory({ pinned: true })]);
    api.updateMemory.mockResolvedValue(item);
    await renderScreen(<MemorySection />);
    const pinnedList = await screen.findByRole('list', { name: m.listLabel });
    expect(within(pinnedList).getByText(m.pinnedBadge)).toBeInTheDocument();
    await user.click(within(pinnedList).getByRole('button', { name: m.unpin }));
    expect(api.updateMemory).toHaveBeenCalledWith(item.id, { pinned: false });
  });

  it('error dengan tombol coba lagi; offline tanpa tombol', async () => {
    api.listMemories.mockRejectedValueOnce(new ApiProblem(500, 'x', 'Server bermasalah.'));
    const view = await renderScreen(<MemorySection />);
    expect(await screen.findByRole('button', { name: copy.states.retry })).toBeInTheDocument();
    view.unmount();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listMemories.mockRejectedValue(new ApiProblem(0, 'network', 'x'));
    await renderScreen(<MemorySection />);
    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: m.add })).toBeDisabled();
  });

  it('usulan memori: tampil dengan kutipan; Simpan, Ubah lalu simpan, dan Tolak memanggil API', async () => {
    const user = userEvent.setup();
    const first = proposal();
    const second = proposal({
      id: '0192f0c4-7a1b-7c2d-8e3f-0000000000bb',
      kind: 'update',
      text: 'Pemilik bekerja sebagai dokter gigi.',
      evidence: 'kerja sebagai dokter gigi',
      targetText: 'Pemilik bekerja sebagai dokter umum.',
    });
    const third = proposal({
      id: '0192f0c4-7a1b-7c2d-8e3f-0000000000cc',
      text: 'Pemilik suka teh.',
    });
    api.listMemoryProposals.mockResolvedValue([first, second, third]);
    api.approveMemoryProposal.mockResolvedValue({ ...first, status: 'approved' });
    api.rejectMemoryProposal.mockResolvedValue({ ...third, status: 'rejected' });
    await renderScreen(<MemorySection />);

    expect(await screen.findByText(m.proposalsTitle(3))).toBeInTheDocument();
    const list = screen.getByRole('list', { name: m.proposalsLabel });
    const rows = within(list).getAllByRole('listitem');
    expect(within(rows[0]!).getByText(m.proposalEvidence(first.evidence))).toBeInTheDocument();
    expect(
      within(rows[1]!).getByText(m.proposalReplaces('Pemilik bekerja sebagai dokter umum.')),
    ).toBeInTheDocument();

    await user.click(within(rows[0]!).getByRole('button', { name: m.proposalApprove }));
    expect(api.approveMemoryProposal).toHaveBeenCalledWith(first.id, undefined);

    await user.click(await within(rows[1]!).findByRole('button', { name: m.proposalEditApprove }));
    const editor = within(rows[1]!).getByRole('textbox', { name: m.proposalEditLabel });
    await user.clear(editor);
    await user.type(editor, 'Pemilik dokter gigi di Bandung.');
    await user.click(within(rows[1]!).getByRole('button', { name: m.proposalApprove }));
    expect(api.approveMemoryProposal).toHaveBeenCalledWith(
      second.id,
      'Pemilik dokter gigi di Bandung.',
    );

    await user.click(await within(rows[2]!).findByRole('button', { name: m.proposalReject }));
    expect(api.rejectMemoryProposal).toHaveBeenCalledWith(third.id);
  });

  it('usulan dari agent: nama agent tampil dan peringatan web muncul bila agent membaca web', async () => {
    api.listMemoryProposals.mockResolvedValue([
      proposal({ source: 'agent', agent: 'omp', afterWeb: true }),
    ]);
    await renderScreen(<MemorySection />);

    const list = await screen.findByRole('list', { name: m.proposalsLabel });
    expect(within(list).getByText(copy.agentProposals.agents.omp)).toBeInTheDocument();
    expect(within(list).getByText(copy.agentProposals.afterWeb)).toBeInTheDocument();
  });

  it('disimpan otomatis: Urungkan memanggil undo, memori hilang, baris tampil Diurungkan', async () => {
    const user = userEvent.setup();
    const resultId = '0192f0c4-7a1b-7c2d-8e3f-0000000000ee';
    const saved = proposal({ status: 'auto_saved', resultMemoryId: resultId, decidedAt: TS });
    const savedMemory = memory({ id: resultId, text: saved.text, source: 'extracted' });
    api.listMemoryProposals.mockResolvedValue([saved]);
    api.listMemories.mockResolvedValue([savedMemory]);
    api.undoMemoryProposal.mockImplementation(() => {
      // Server: memori hasil dihapus, usulan menjadi undone.
      api.listMemories.mockResolvedValue([]);
      api.listMemoryProposals.mockResolvedValue([{ ...saved, status: 'undone' }]);
      return Promise.resolve({ ...saved, status: 'undone' });
    });
    await renderScreen(<MemorySection />);

    const list = await screen.findByRole('list', { name: m.autoLabel });
    expect(screen.getByText(m.autoTitle(1))).toBeInTheDocument();
    expect(screen.queryByText(m.proposalsIntro)).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: m.proposalApprove })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: m.listLabel })).toBeInTheDocument();

    await user.click(within(list).getByRole('button', { name: m.proposalUndo }));
    expect(api.undoMemoryProposal).toHaveBeenCalledWith(saved.id);
    expect(await within(list).findByText(m.proposalUndone)).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: m.proposalUndo })).not.toBeInTheDocument();
    expect(await screen.findByText(m.proposalUndoneToast)).toBeInTheDocument();
    expect(await screen.findByText(m.empty)).toBeInTheDocument();
  });

  it('tanpa usulan: blok usulan tidak tampil; gagal memuat usulan menampilkan coba lagi', async () => {
    api.listMemories.mockResolvedValue([memory()]);
    const view = await renderScreen(<MemorySection />);
    await screen.findByRole('list', { name: m.listLabel });
    expect(screen.queryByText(m.proposalsIntro)).not.toBeInTheDocument();
    view.unmount();

    api.listMemoryProposals.mockRejectedValue(new ApiProblem(500, 'x', 'Server bermasalah.'));
    await renderScreen(<MemorySection />);
    expect(await screen.findByText(m.proposalsError)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.states.retry })).toBeEnabled();
  });

  it('memori dari percakapan menautkan ke percakapan asal; asal yang dihapus tanpa tautan', async () => {
    const user = userEvent.setup();
    api.listMemories.mockResolvedValue([
      memory({ source: 'extracted', origin: { conversationId: CONVERSATION, messageId: null } }),
      memory({ id: '0192f0c4-7a1b-7c2d-8e3f-0000000000dd', source: 'extracted', origin: null }),
      memory({ id: '0192f0c4-7a1b-7c2d-8e3f-0000000000ee' }),
    ]);
    const view = await renderScreen(<MemorySection />);
    const list = await screen.findByRole('list', { name: m.listLabel });
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(within(list).getByText(m.fromDeletedConversation)).toBeInTheDocument();
    await user.click(within(list).getByRole('link', { name: m.fromConversation }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe(`/chat/${CONVERSATION}`));
  });
});

describe('RememberDialog', () => {
  it('teks pesan bisa disunting lalu disimpan sebagai memori', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    api.createMemory.mockResolvedValue(memory());
    await renderScreen(<RememberDialog text="Tolong selalu jawab singkat ya." onClose={onClose} />);

    const field = await screen.findByRole('textbox', { name: m.addLabel });
    expect(field).toHaveValue('Tolong selalu jawab singkat ya.');
    await user.clear(field);
    await user.type(field, 'Saya suka jawaban singkat.');
    await user.click(screen.getByRole('button', { name: m.add }));

    expect(api.createMemory).toHaveBeenCalledWith('Saya suka jawaban singkat.');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
