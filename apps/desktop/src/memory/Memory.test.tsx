import type { Memory } from '@aios/contracts';
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
  createdAt: TS,
  updatedAt: TS,
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
