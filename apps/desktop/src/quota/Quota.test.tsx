import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quota } from '../api/gateway';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { QuotaScreen } = await import('./QuotaScreen');

const quota: Quota = {
  source: 'ninerouter',
  totals: { requests: 42, inputTokens: 120_000, outputTokens: 30_500, costUsd: 1.2345 },
  byModel: [
    { model: 'combo/code', requests: 30, inputTokens: 100_000, outputTokens: 25_000, costUsd: 1 },
    {
      model: 'combo/fast',
      requests: 12,
      inputTokens: 20_000,
      outputTokens: 5_500,
      costUsd: 0.2345,
    },
  ],
  byDay: [
    { date: '2026-10-21', requests: 10, inputTokens: 10_000, outputTokens: 2_000, costUsd: 0.1 },
    {
      date: '2026-10-22',
      requests: 32,
      inputTokens: 110_000,
      outputTokens: 28_500,
      costUsd: 1.1345,
    },
  ],
};

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('QuotaScreen', () => {
  it('total, per model, dan per hari (hari terbaru di atas) dengan angka terformat', async () => {
    api.getQuota.mockResolvedValue(quota);
    await renderScreen(<QuotaScreen />, '/quota');

    expect(await screen.findByText(copy.quota.source.ninerouter)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('$1,23')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'combo/code' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'combo/fast' })).toBeInTheDocument();

    const days = screen.getAllByRole('rowheader').filter((h) => /^\d{4}-/.test(h.textContent));
    expect(days.map((d) => d.textContent)).toEqual(['2026-10-22', '2026-10-21']);
  });

  it('sumber dari ringkasan run diberi catatan', async () => {
    api.getQuota.mockResolvedValue({ ...quota, source: 'runs' });
    await renderScreen(<QuotaScreen />, '/quota');
    expect(await screen.findByText(copy.quota.source.runs)).toBeInTheDocument();
  });

  it('kosong, error dengan coba lagi, dan memuat', async () => {
    api.getQuota.mockResolvedValue({
      source: 'runs',
      totals: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      byModel: [],
      byDay: [],
    });
    const empty = await renderScreen(<QuotaScreen />, '/quota');
    expect(await screen.findByText(copy.quota.empty)).toBeInTheDocument();
    empty.unmount();

    api.getQuota.mockReset();
    api.getQuota.mockRejectedValueOnce(new ApiProblem(500, 'internal_error', 'x'));
    api.getQuota.mockResolvedValue(quota);
    const user = userEvent.setup();
    const error = await renderScreen(<QuotaScreen />, '/quota');
    await user.click(await screen.findByRole('button', { name: copy.states.retry }));
    expect(await screen.findByText(copy.quota.source.ninerouter)).toBeInTheDocument();
    error.unmount();

    api.getQuota.mockReset();
    api.getQuota.mockReturnValue(new Promise(() => undefined));
    await renderScreen(<QuotaScreen />, '/quota');
    expect(await screen.findByRole('status', { name: copy.quota.loading })).toBeInTheDocument();
  });

  it('offline: pesan offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.getQuota.mockRejectedValue(new Error('jaringan'));
    await renderScreen(<QuotaScreen />, '/quota');
    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });
});
