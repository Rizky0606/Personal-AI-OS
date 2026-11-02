import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { models } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { SidebarStatus } = await import('./SidebarStatus');

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listModels.mockResolvedValue(models);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('SidebarStatus: kuota', () => {
  it('tanpa data kuota (galat atau kosong): baris kuota tidak tampil, bukan "Kuota 0 token"', async () => {
    api.getQuota.mockRejectedValue(new Error('x'));
    await renderScreen(<SidebarStatus />);

    expect(screen.queryByRole('link', { name: /Kuota/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Kuota/)).not.toBeInTheDocument();
    // Status lain tetap ada.
    expect(screen.getByText(copy.status.idle)).toBeInTheDocument();
  });

  it('data ada tetapi nol token: baris kuota tidak tampil', async () => {
    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<SidebarStatus />);
    await waitFor(() => expect(api.getQuota).toHaveBeenCalled());
    expect(screen.queryByText(/Kuota/)).not.toBeInTheDocument();
  });

  it('ada token tetapi biaya 0 atau tak tersedia: hanya token, tanpa "$0,00"', async () => {
    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 5, inputTokens: 12_000, outputTokens: 300, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<SidebarStatus />);

    const link = await screen.findByRole('link', { name: copy.status.quotaTokens('12,3 rb') });
    expect(link).toHaveTextContent('Kuota 12,3 rb token');
    expect(link).not.toHaveTextContent('$');
  });

  it('ada token dan biaya di atas 0: ringkasan memuat biaya', async () => {
    api.getQuota.mockResolvedValue({
      source: 'ninerouter',
      totals: { requests: 5, inputTokens: 12_000, outputTokens: 300, costUsd: 0.5 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<SidebarStatus />);

    expect(
      await screen.findByText(copy.status.quotaSummary('12,3 rb', '$0,50')),
    ).toBeInTheDocument();
  });

  it('sidebar ringkas: ikon kuota ikut disembunyikan tanpa data token, dan tampil dengan nama lengkap bila ada', async () => {
    api.getQuota.mockRejectedValue(new Error('x'));
    const view = await renderScreen(<SidebarStatus collapsed />);
    expect(screen.queryByRole('link', { name: /Kuota/ })).not.toBeInTheDocument();
    view.unmount();

    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 1, inputTokens: 1_500, outputTokens: 0, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    await renderScreen(<SidebarStatus collapsed />);
    expect(await screen.findByRole('link', { name: /Kuota 1,5 rb token/ })).toBeInTheDocument();
  });
});
