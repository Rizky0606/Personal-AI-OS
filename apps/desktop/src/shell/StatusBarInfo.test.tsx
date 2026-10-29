import { screen, waitFor } from '@testing-library/react';
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
  it('bawaan: model otomatis, tanpa teks role, dan tanpa panel kuota bila datanya tidak ada', async () => {
    api.getQuota.mockRejectedValue(new Error('x'));
    await renderScreen(<StatusBar />);

    expect(screen.queryByText(/role otomatis/i)).not.toBeInTheDocument();
    expect(screen.getByText(copy.status.model)).toBeInTheDocument();
    await waitFor(() => expect(api.getQuota).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /^Kuota/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Kuota/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('kuota ada tetapi nol pemakaian: panel kuota disembunyikan, tidak ada "$0,00"', async () => {
    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<StatusBar />);

    await waitFor(() => expect(api.getQuota).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /^Kuota/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('pemakaian ada tetapi biaya tidak tercatat (0): tampilkan token saja, tanpa angka biaya', async () => {
    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 5, inputTokens: 12_000, outputTokens: 300, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<StatusBar />);

    const link = await screen.findByRole('link', { name: /^Kuota/ });
    expect(link).toHaveTextContent(copy.status.quotaTokens('12,3 rb'));
    expect(link).not.toHaveTextContent('$');
  });

  it('menampilkan nama role aktif, label model pilihan, dan ringkasan kuota', async () => {
    useUiStore.setState({ activeRole: 'project', model: 'combo/fast' });
    api.getQuota.mockResolvedValue({
      source: 'ninerouter',
      totals: { requests: 5, inputTokens: 12_000, outputTokens: 300, costUsd: 0.5 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<StatusBar />);

    expect(await screen.findByText('Project')).toBeInTheDocument();
    expect(screen.getByText('Cepat')).toBeInTheDocument();
    expect(
      await screen.findByText(copy.status.quotaSummary('12,3 rb', '$0,50')),
    ).toBeInTheDocument();
  });
});
