import type { MemoryProposal } from '@aios/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { api, resetApi } from '../test/fakeServices';
import { TS } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { MemoryAutoSavedCards } = await import('./MemoryAutoSavedCards');

const m = copy.memory;
const t = copy.chat.autoMemory;
const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d9a10';
const MSG = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d9a11';
const OTHER = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d9a12';

const proposal = (over: Partial<MemoryProposal> = {}): MemoryProposal => ({
  id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d9a01',
  kind: 'add',
  status: 'auto_saved',
  text: 'Pemilik tinggal di Bandung.',
  evidence: 'saya tinggal di Bandung',
  targetMemoryId: null,
  targetText: null,
  previousText: null,
  resultMemoryId: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d9a02',
  conversationId: CONV,
  messageId: MSG,
  runId: null,
  model: 'router-fast',
  source: 'extraction',
  agent: null,
  afterWeb: false,
  createdAt: TS,
  decidedAt: TS,
  ...over,
});

beforeEach(() => {
  resetApi();
});

describe('memori yang disimpan otomatis di bawah pesan', () => {
  it('menampilkan fakta yang disimpan; Urungkan memanggil undo lalu baris tampil Diurungkan', async () => {
    const user = userEvent.setup();
    const saved = proposal();
    api.listMemoryProposals.mockResolvedValue([saved]);
    api.undoMemoryProposal.mockImplementation(() => {
      api.listMemoryProposals.mockResolvedValue([{ ...saved, status: 'undone' }]);
      return Promise.resolve({ ...saved, status: 'undone' });
    });
    await renderScreen(<MemoryAutoSavedCards messageId={MSG} />);

    const list = await screen.findByRole('list', { name: t.list });
    expect(screen.getByText(saved.text)).toBeInTheDocument();
    expect(screen.getByText(t.title)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: m.proposalUndo }));
    expect(api.undoMemoryProposal).toHaveBeenCalledWith(saved.id);
    expect(await screen.findByText(m.proposalUndone)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: m.proposalUndo })).not.toBeInTheDocument();
    expect(screen.getByText(saved.text)).toHaveClass('line-through');
    expect(list).toBeInTheDocument();
  });

  it('usulan yang masih menunggu keputusan dan pesan lain tidak merender apa pun', async () => {
    api.listMemoryProposals.mockResolvedValue([
      proposal({ status: 'pending', decidedAt: null, resultMemoryId: null }),
      proposal({ id: '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d9a03', messageId: OTHER }),
    ]);
    const { container } = await renderScreen(<MemoryAutoSavedCards messageId={MSG} />);
    await vi.waitFor(() => expect(api.listMemoryProposals).toHaveBeenCalled());
    expect(container.querySelector('ul')).toBeNull();
    expect(screen.queryByRole('button', { name: m.proposalUndo })).not.toBeInTheDocument();
  });
});
