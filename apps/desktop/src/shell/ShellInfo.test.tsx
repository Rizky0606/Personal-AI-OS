import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { models, roles } from '../test/fixtures';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { Header } = await import('./Header');
const { SidebarStatus } = await import('./SidebarStatus');

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listRoles.mockResolvedValue(roles);
  api.listModels.mockResolvedValue(models);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('Header: role dan model', () => {
  it('bawaan: role dan model otomatis, tanpa penanda run berjalan', async () => {
    await renderScreen(<Header title={copy.nav.chat} />);

    expect(screen.getByRole('heading', { level: 1, name: copy.nav.chat })).toBeInTheDocument();
    expect(
      screen.getByText(copy.status.role, { selector: '[data-status-role]' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(copy.status.model, { selector: '[data-status-model]' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(copy.shell.runActive)).not.toBeInTheDocument();
  });

  it('menampilkan nama role aktif dan label model pilihan', async () => {
    useUiStore.setState({ activeRole: 'project', model: 'combo/fast' });
    await renderScreen(<Header title={copy.nav.chat} />);

    expect(await screen.findByText('Project')).toBeInTheDocument();
    expect(screen.getByText('Cepat')).toBeInTheDocument();
  });

  it('saat run coding berjalan, pil status menandai Berjalan', async () => {
    useUiStore.setState({ activeRunBranch: 'aios/abcd1234' });
    await renderScreen(<Header title={copy.nav.chat} />);

    expect(screen.getByText(copy.shell.runActive)).toBeInTheDocument();
  });
});

describe('SidebarStatus: kuota', () => {
  it('kuota "-" bila belum ada angka, tautannya ke halaman Kuota', async () => {
    api.getQuota.mockRejectedValue(new Error('x'));
    await renderScreen(<SidebarStatus />);

    expect(screen.getByRole('link', { name: copy.status.quotaTokens('0') })).toHaveTextContent(
      copy.status.quotaTokens('0'),
    );
  });

  it('menampilkan ringkasan kuota', async () => {
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
});
