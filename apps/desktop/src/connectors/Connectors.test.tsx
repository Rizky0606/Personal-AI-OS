import type { McpConnector, McpConnectorProbe, McpConnectorTool } from '@aios/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { TS } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { ConnectorsScreen } = await import('./ConnectorsScreen');

const t = copy.connectorsPage;

const tool = (over: Partial<McpConnectorTool> = {}): McpConnectorTool => ({
  name: 'list_repos',
  description: 'Daftar repositori.',
  inputSchema: { type: 'object' },
  readOnly: true,
  ...over,
});

const connector = (over: Partial<McpConnector> = {}): McpConnector => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'github',
  displayName: 'GitHub',
  url: 'https://api.githubcopilot.com/mcp/',
  hasToken: true,
  enabled: false,
  tools: [tool(), tool({ name: 'create_issue', description: 'Buat isu.', readOnly: false })],
  lastProbeAt: TS,
  lastError: null,
  createdAt: TS,
  updatedAt: TS,
  ...over,
});

const probe = (over: Partial<McpConnectorProbe> = {}): McpConnectorProbe => ({
  url: 'https://api.githubcopilot.com/mcp/',
  serverName: 'github-mcp',
  serverVersion: '1.2.0',
  protocolVersion: '2025-03-26',
  tools: [tool(), tool({ name: 'create_issue', description: 'Buat isu.', readOnly: false })],
  truncated: false,
  ...over,
});

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('ConnectorsScreen: Konektor saya', () => {
  it('menampilkan konektor beserta jumlah tool baca dan tulis', async () => {
    api.listMcpConnectors.mockResolvedValue([connector()]);
    await renderScreen(<ConnectorsScreen />);

    expect(await screen.findByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText(t.mine.slug('github'))).toBeInTheDocument();
    expect(screen.getByText(t.mine.host('api.githubcopilot.com'))).toBeInTheDocument();
    expect(screen.getByText(t.mine.toolCount(2))).toBeInTheDocument();
    expect(screen.getByText(t.mine.readWrite(1, 1))).toBeInTheDocument();
  });

  it('menyalakan konektor lewat sakelar', async () => {
    const user = userEvent.setup();
    api.listMcpConnectors.mockResolvedValue([connector()]);
    api.setMcpConnectorEnabled.mockResolvedValue(connector({ enabled: true }));
    await renderScreen(<ConnectorsScreen />);

    await user.click(await screen.findByRole('switch', { name: t.mine.toggle('GitHub') }));
    await waitFor(() =>
      expect(api.setMcpConnectorEnabled).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        true,
      ),
    );
  });

  it('memeriksa ulang konektor tersimpan', async () => {
    const user = userEvent.setup();
    api.listMcpConnectors.mockResolvedValue([connector()]);
    api.reprobeMcpConnector.mockResolvedValue(probe());
    await renderScreen(<ConnectorsScreen />);

    await user.click(await screen.findByRole('button', { name: t.mine.reprobe }));
    await waitFor(() =>
      expect(api.reprobeMcpConnector).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111'),
    );
  });

  it('menghapus konektor setelah konfirmasi', async () => {
    const user = userEvent.setup();
    api.listMcpConnectors.mockResolvedValue([connector()]);
    api.deleteMcpConnector.mockResolvedValue(undefined);
    await renderScreen(<ConnectorsScreen />);

    await user.click(await screen.findByRole('button', { name: t.mine.delete }));
    await user.click(await screen.findByRole('button', { name: t.mine.deleteConfirm }));
    await waitFor(() =>
      expect(api.deleteMcpConnector).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111'),
    );
  });

  it('menampilkan keadaan kosong dengan ajakan menambah konektor', async () => {
    api.listMcpConnectors.mockResolvedValue([]);
    await renderScreen(<ConnectorsScreen />);

    expect(await screen.findByText(t.mine.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.mine.addAction })).toBeEnabled();
  });

  it('menampilkan galat daftar dengan tombol coba lagi', async () => {
    api.listMcpConnectors.mockRejectedValue(new ApiProblem(500, 'internal', 'Gagal memuat.'));
    await renderScreen(<ConnectorsScreen />);

    expect(await screen.findByRole('button', { name: copy.states.retry })).toBeInTheDocument();
  });

  it('menampilkan keadaan offline tanpa memanggil API', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listMcpConnectors.mockRejectedValue(new ApiProblem(0, 'network', 'Tidak ada koneksi.'));
    await renderScreen(<ConnectorsScreen />);

    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
  });
});

describe('ConnectorsScreen: Tambah', () => {
  async function openAdd() {
    const user = userEvent.setup();
    await renderScreen(<ConnectorsScreen />);
    await user.click(screen.getByRole('tab', { name: t.tabs.add }));
    return user;
  }
  async function fillForm(user: UserEvent) {
    await user.type(screen.getByLabelText(t.add.name), 'github');
    await user.type(screen.getByLabelText(t.add.displayName), 'GitHub');
    await user.type(screen.getByLabelText(t.add.url), 'https://api.githubcopilot.com/mcp/');
    await user.type(screen.getByLabelText(t.add.token), 'rahasia-token');
  }

  it('periksa lalu simpan mengunci tool yang dilihat pemilik', async () => {
    api.probeMcpConnector.mockResolvedValue(probe());
    api.createMcpConnector.mockResolvedValue(connector());
    const user = await openAdd();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: t.add.probe }));

    expect(await screen.findByText(t.add.server('github-mcp', '1.2.0'))).toBeInTheDocument();
    // Tool tulis dilepas; yang tersimpan hanya yang masih tercentang.
    await user.click(screen.getByRole('checkbox', { name: /create_issue/ }));
    await user.click(screen.getByRole('button', { name: t.add.save }));

    await waitFor(() =>
      expect(api.createMcpConnector).toHaveBeenCalledWith({
        name: 'github',
        displayName: 'GitHub',
        url: 'https://api.githubcopilot.com/mcp/',
        token: 'rahasia-token',
        tools: [tool()],
      }),
    );
  });

  it('menandai tool tanpa penanda hanya-baca sebagai tulis', async () => {
    api.probeMcpConnector.mockResolvedValue(probe());
    const user = await openAdd();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: t.add.probe }));

    expect(await screen.findByText(t.add.writeWarning)).toBeInTheDocument();
    expect(screen.getByText(t.add.write)).toBeInTheDocument();
  });

  it('tidak pernah menampilkan token dari jawaban server', async () => {
    api.probeMcpConnector.mockResolvedValue(probe());
    api.createMcpConnector.mockResolvedValue(connector());
    const user = await openAdd();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: t.add.probe }));
    await user.click(await screen.findByRole('button', { name: t.add.save }));

    await waitFor(() => expect(api.createMcpConnector).toHaveBeenCalled());
    // Kolom token dikosongkan setelah simpan dan tidak pernah diisi ulang dari server.
    expect(screen.queryByDisplayValue('rahasia-token')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('rahasia-token');
  });

  it('menjelaskan kegagalan pemeriksaan server konektor', async () => {
    api.probeMcpConnector.mockRejectedValue(
      new ApiProblem(502, 'connector_unreachable', 'Server konektor tidak menjawab.'),
    );
    const user = await openAdd();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: t.add.probe }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server konektor tidak menjawab.');
  });
});
