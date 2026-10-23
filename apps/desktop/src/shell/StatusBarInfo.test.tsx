import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { models, roles } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { StatusBar } = await import('./StatusBar');

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listRoles.mockResolvedValue(roles);
  api.listModels.mockResolvedValue(models);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('StatusBar: role, model, dan kuota', () => {
  it('bawaan: role dan model otomatis; kuota "-" bila belum ada angka, tautannya ke halaman Kuota', async () => {
    api.getQuota.mockRejectedValue(new Error('x'));
    await renderScreen(<StatusBar />);

    expect(screen.getByText(copy.status.role)).toBeInTheDocument();
    expect(screen.getByText(copy.status.model)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.status.quota })).toHaveTextContent(
      copy.status.quota,
    );
  });

  it('menampilkan nama role aktif, label model pilihan, dan ringkasan kuota', async () => {
    useUiStore.setState({ activeRole: 'frontend', model: 'combo/fast' });
    api.getQuota.mockResolvedValue({
      source: 'ninerouter',
      totals: { requests: 5, inputTokens: 12_000, outputTokens: 300, costUsd: 0.5 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<StatusBar />);

    expect(await screen.findByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Cepat')).toBeInTheDocument();
    expect(
      await screen.findByText(copy.status.quotaSummary('12,3 rb', '$0,50')),
    ).toBeInTheDocument();
  });
});
