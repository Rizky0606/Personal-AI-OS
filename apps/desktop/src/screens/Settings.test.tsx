import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { SettingsScreen } = await import('./SettingsScreen');

const models = [
  { id: 'auto', label: 'Combo cepat', kind: 'combo' as const, ownedBy: 'router' },
  { id: 'gpt-x', label: 'GPT X', kind: 'model' as const, ownedBy: 'openai' },
];

function mockMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
}

beforeEach(() => {
  resetApi();
  api.listModels.mockResolvedValue(models);
  useUiStore.setState({ theme: 'system', model: null, reduceMotion: null, inAppToasts: true });
  document.documentElement.removeAttribute('data-reduce-motion');
  mockMatchMedia(false);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('SettingsScreen: kelompok', () => {
  it('enam kelompok berurutan: Akun, Koneksi, Model, Tampilan, Notifikasi, Lanjutan', async () => {
    await renderScreen(<SettingsScreen />, '/settings');
    const names = (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent);
    expect(names).toEqual([
      copy.settings.title,
      copy.settings.groups.account,
      copy.settings.groups.connection,
      copy.settings.groups.model,
      copy.settings.groups.appearance,
      copy.settings.groups.notifications,
      copy.settings.groups.advanced,
    ]);
  });

  it('Akun memuat perangkat dan tombol keluar; Koneksi memuat server dan tautan status', async () => {
    await renderScreen(<SettingsScreen />, '/settings');
    const account = await screen.findByRole('region', { name: copy.settings.groups.account });
    expect(within(account).getByRole('button', { name: copy.settings.logout })).toBeInTheDocument();
    const connection = screen.getByRole('region', { name: copy.settings.groups.connection });
    expect(within(connection).getByText(copy.settings.server)).toBeInTheDocument();
    expect(
      within(connection).getByRole('link', { name: copy.status.page.title }),
    ).toBeInTheDocument();
  });
});

describe('SettingsScreen: pemilih model (memuat, kosong, error, sukses)', () => {
  const group = () => screen.findByRole('region', { name: copy.settings.groups.model });

  it('sukses: tiap model punya keterangan singkat; memilih menyimpan pilihan', async () => {
    const user = userEvent.setup();
    await renderScreen(<SettingsScreen />, '/settings');
    const region = await group();
    await within(region).findByText('GPT X');
    expect(within(region).getByText(copy.settings.modelHint.combo)).toBeInTheDocument();
    expect(within(region).getByText(copy.settings.modelHint.model('openai'))).toBeInTheDocument();
    await user.click(within(region).getByRole('radio', { name: /GPT X/ }));
    expect(useUiStore.getState().model).toBe('gpt-x');
    await user.click(within(region).getByRole('radio', { name: new RegExp(copy.settings.modelAuto) }));
    expect(useUiStore.getState().model).toBeNull();
  });

  it('memuat: kerangka berlabel, bukan spinner', async () => {
    api.listModels.mockReturnValue(new Promise(() => undefined));
    await renderScreen(<SettingsScreen />, '/settings');
    const region = await group();
    expect(within(region).getByRole('status', { name: copy.settings.modelLoading })).toBeInTheDocument();
  });

  it('kosong: satu kalimat dan satu tombol muat ulang', async () => {
    api.listModels.mockResolvedValue([]);
    await renderScreen(<SettingsScreen />, '/settings');
    const region = await group();
    expect(await within(region).findByText(copy.settings.modelEmpty)).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: copy.states.retry })).toBeInTheDocument();
  });

  it('error: pesan dengan Coba lagi yang memuat ulang', async () => {
    const user = userEvent.setup();
    api.listModels.mockRejectedValueOnce(new ApiProblem(500, 'x', 'Server gagal'));
    await renderScreen(<SettingsScreen />, '/settings');
    const region = await group();
    expect(await within(region).findByRole('alert')).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: copy.states.retry }));
    await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(2));
  });
});

describe('SettingsScreen: tampilan', () => {
  it('tema terang/gelap/sistem tersimpan di store', async () => {
    const user = userEvent.setup();
    await renderScreen(<SettingsScreen />, '/settings');
    await user.click(await screen.findByRole('button', { name: copy.settings.themeDark }));
    expect(useUiStore.getState().theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: copy.settings.themeSystem }));
    expect(useUiStore.getState().theme).toBe('system');
  });

  it('kurangi gerakan: bawaan mengikuti sistem; sakelar menyimpan pilihan eksplisit; Ikuti sistem mengembalikan', async () => {
    const user = userEvent.setup();
    mockMatchMedia(true);
    await renderScreen(<SettingsScreen />, '/settings');
    const toggle = await screen.findByRole('switch', { name: copy.settings.reduceMotion });
    expect(toggle).toBeChecked();
    expect(screen.getByText(copy.settings.reduceMotionSystem)).toBeInTheDocument();

    await user.click(toggle);
    expect(useUiStore.getState().reduceMotion).toBe(false);
    expect(toggle).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: copy.settings.reduceMotionReset }));
    expect(useUiStore.getState().reduceMotion).toBeNull();
    expect(toggle).toBeChecked();
  });
});

describe('SettingsScreen: notifikasi', () => {
  it('sakelar notifikasi di aplikasi menyimpan pilihan', async () => {
    const user = userEvent.setup();
    await renderScreen(<SettingsScreen />, '/settings');
    const toggle = await screen.findByRole('switch', { name: copy.settings.inAppToasts });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(useUiStore.getState().inAppToasts).toBe(false);
  });
});
