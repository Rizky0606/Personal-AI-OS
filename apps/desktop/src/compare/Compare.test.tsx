import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { CompareScreen } = await import('./CompareScreen');

const catalog = [
  { id: 'combo/fast', label: 'Cepat', kind: 'combo' as const, ownedBy: '9router' },
  { id: 'combo/code', label: 'Kode', kind: 'combo' as const, ownedBy: '9router' },
  { id: 'gpt/x', label: 'GPT X', kind: 'model' as const, ownedBy: 'openai' },
];

beforeEach(() => {
  resetApi();
  api.listModels.mockResolvedValue(catalog);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

const promptField = () => screen.findByRole('textbox', { name: copy.compare.prompt });

describe('CompareScreen', () => {
  it('dua model bawaan; prompt wajib; menjalankan mengirim prompt dan model terpilih', async () => {
    api.compareModels.mockResolvedValue([
      {
        model: 'combo/fast',
        ok: true,
        text: 'Jawaban **cepat**',
        latencyMs: 840,
        usage: { inputTokens: 10, outputTokens: 20 },
        error: null,
      },
      {
        model: 'combo/code',
        ok: true,
        text: 'Jawaban kode',
        latencyMs: 2400,
        usage: null,
        error: null,
      },
    ]);
    const user = userEvent.setup();
    await renderScreen(<CompareScreen />, '/compare');
    await promptField();

    await user.click(await screen.findByRole('button', { name: copy.compare.run }));
    expect(await screen.findByText(copy.compare.emptyPrompt)).toBeInTheDocument();
    expect(api.compareModels).not.toHaveBeenCalled();

    await user.type(await promptField(), 'jelaskan closure');
    await user.click(screen.getByRole('button', { name: copy.compare.run }));

    await waitFor(() =>
      expect(api.compareModels).toHaveBeenCalledWith('jelaskan closure', [
        'combo/fast',
        'combo/code',
      ]),
    );
    const results = await screen.findByRole('group', { name: copy.compare.results });
    const fast = within(results).getByRole('region', { name: 'Cepat' });
    expect(within(fast).getByText('cepat').tagName).toBe('STRONG');
    expect(fast).toHaveTextContent('840 ms');
    expect(fast).toHaveTextContent('10 → 20');
    expect(within(results).getByRole('region', { name: 'Kode' })).toHaveTextContent('2,4 dtk');
  });

  it('Ctrl+Enter menjalankan; model ketiga bisa ditambah dan dihapus; maksimal tiga', async () => {
    api.compareModels.mockResolvedValue([]);
    const user = userEvent.setup();
    await renderScreen(<CompareScreen />, '/compare');
    await user.type(await promptField(), 'halo');

    await user.click(await screen.findByRole('button', { name: copy.compare.add }));
    expect(screen.queryByRole('button', { name: copy.compare.add })).toBeNull();
    // Tombol Tambah hilang saat penuh (fokus lepas): kembali ke kolom prompt sebelum Ctrl+Enter.
    await user.click(await promptField());
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() =>
      expect(api.compareModels).toHaveBeenCalledWith('halo', ['combo/fast', 'combo/code', 'gpt/x']),
    );

    await user.click(screen.getByRole('button', { name: copy.compare.remove(3) }));
    expect(screen.getByRole('button', { name: copy.compare.add })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.compare.remove(1) })).toBeNull();
  });

  it('memilih model yang sama di dua slot ditolak sebelum dikirim', async () => {
    const user = userEvent.setup();
    await renderScreen(<CompareScreen />, '/compare');
    await user.type(await promptField(), 'halo');

    await user.click(
      await screen.findByRole('button', { name: new RegExp(`${copy.compare.modelSlot(2)}:`) }),
    );
    await user.click(await screen.findByRole('menuitemradio', { name: /Cepat/ }));
    await user.click(screen.getByRole('button', { name: copy.compare.run }));

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.compare.needTwo);
    expect(api.compareModels).not.toHaveBeenCalled();
  });

  it('satu model gagal: galatnya tampil di kolomnya, kolom lain tetap', async () => {
    api.compareModels.mockResolvedValue([
      {
        model: 'combo/fast',
        ok: false,
        text: '',
        latencyMs: 90,
        usage: null,
        error: 'provider mati',
      },
      { model: 'combo/code', ok: true, text: 'Baik', latencyMs: 500, usage: null, error: null },
    ]);
    const user = userEvent.setup();
    await renderScreen(<CompareScreen />, '/compare');
    await user.type(await promptField(), 'halo');

    await user.click(await screen.findByRole('button', { name: copy.compare.run }));

    const failed = await screen.findByRole('region', { name: 'Cepat' });
    expect(within(failed).getByRole('alert')).toHaveTextContent('provider mati');
    expect(screen.getByRole('region', { name: 'Kode' })).toHaveTextContent('Baik');
  });

  it('server gagal: pesan error umum; daftar model kosong: petunjuk', async () => {
    api.compareModels.mockRejectedValue(new ApiProblem(502, 'router_unavailable', 'x'));
    const user = userEvent.setup();
    const first = await renderScreen(<CompareScreen />, '/compare');
    await user.type(await promptField(), 'halo');
    await user.click(await screen.findByRole('button', { name: copy.compare.run }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.server);
    first.unmount();

    api.listModels.mockResolvedValue([]);
    await renderScreen(<CompareScreen />, '/compare');
    expect(await screen.findByText(copy.compare.noModels)).toBeInTheDocument();
  });
});
