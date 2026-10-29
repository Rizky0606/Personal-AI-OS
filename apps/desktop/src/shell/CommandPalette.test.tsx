import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';
import { NAV_ROUTES, shortcutHint } from './navRoutes';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { CommandPalette } = await import('./CommandPalette');

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  useUiStore.setState({ paletteOpen: true });
});

const input = () => screen.findByRole('combobox', { name: copy.palette.input });
const options = () => screen.getAllByRole('option');
const activeId = () => screen.getByRole('combobox').getAttribute('aria-activedescendant');
const selected = () => options().find((o) => o.getAttribute('aria-selected') === 'true');

describe('CommandPalette (pulau melayang)', () => {
  it('terbuka dengan fokus di kolom cari; tanpa query hanya perintah dan navigasi', async () => {
    await renderScreen(<CommandPalette />);
    expect(await input()).toHaveFocus();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(copy.palette.groups.action)).toBeInTheDocument();
    expect(within(dialog).getByText(copy.palette.groups.go)).toBeInTheDocument();
    expect(within(dialog).queryByText(copy.palette.groups.conversation)).toBeNull();
    expect(within(dialog).queryByText(copy.palette.groups.theme)).toBeNull();
  });

  it('mengetik menyaring dan mengelompokkan hasil di bawah judul grup', async () => {
    const user = userEvent.setup();
    await renderScreen(<CommandPalette />);
    await input();
    await user.keyboard('Tema');
    const list = screen.getByRole('listbox', { name: copy.palette.results });
    expect(within(list).getByText(copy.palette.groups.theme)).toBeInTheDocument();
    for (const o of within(list).getAllByRole('option')) expect(o).toHaveTextContent(/Tema/);
  });

  it('ArrowDown/ArrowUp berputar dan memperbarui aria-activedescendant', async () => {
    const user = userEvent.setup();
    await renderScreen(<CommandPalette />);
    await input();
    const all = options();
    expect(all.length).toBeGreaterThan(2);
    expect(activeId()).toBe(all[0]!.id);
    expect(all[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(activeId()).toBe(all[1]!.id);
    expect(selected()).toBe(all[1]);

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(activeId()).toBe(all[all.length - 1]!.id);

    await user.keyboard('{ArrowDown}');
    expect(activeId()).toBe(all[0]!.id);
  });

  it('Home dan End melompat ke baris pertama dan terakhir', async () => {
    const user = userEvent.setup();
    await renderScreen(<CommandPalette />);
    await input();
    const all = options();
    await user.keyboard('{End}');
    expect(activeId()).toBe(all[all.length - 1]!.id);
    await user.keyboard('{Home}');
    expect(activeId()).toBe(all[0]!.id);
  });

  it('mouse di atas baris memilihnya', async () => {
    const user = userEvent.setup();
    await renderScreen(<CommandPalette />);
    await input();
    const all = options();
    await user.hover(all[2]!);
    expect(activeId()).toBe(all[2]!.id);
    expect(selected()).toBe(all[2]);
  });

  it('Enter menjalankan baris terpilih lalu menutup palet', async () => {
    const user = userEvent.setup();
    const { router } = await renderScreen(<CommandPalette />);
    await input();
    await user.keyboard(copy.nav.kanban);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/kanban'));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('klik pada baris menjalankannya', async () => {
    const user = userEvent.setup();
    const { router } = await renderScreen(<CommandPalette />);
    await input();
    await user.click(screen.getByRole('option', { name: new RegExp(copy.nav.kanban) }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/kanban'));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('Esc menutup dan fokus kembali ke pembuka', async () => {
    const user = userEvent.setup();
    useUiStore.setState({ paletteOpen: false });
    await renderScreen(
      <>
        <button type="button" onClick={() => useUiStore.getState().setPaletteOpen(true)}>
          pembuka
        </button>
        <CommandPalette />
      </>,
    );
    const opener = await screen.findByRole('button', { name: 'pembuka' });
    await user.click(opener);
    expect(await input()).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useUiStore.getState().paletteOpen).toBe(false);
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('Tab dan Shift+Tab tidak keluar dari dialog', async () => {
    const user = userEvent.setup();
    await renderScreen(
      <>
        <button type="button">di luar</button>
        <CommandPalette />
      </>,
    );
    await input();
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 4; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('setiap baris navigasi dengan pintasan menampilkan hint Ctrl+N', async () => {
    await renderScreen(<CommandPalette />);
    await input();
    const hints = NAV_ROUTES.map((route) => shortcutHint(route));
    expect(hints).toHaveLength(6);
    for (const hint of hints) {
      expect(hint).toMatch(/^Ctrl\+\d$/);
      const rows = options().filter((o) => within(o).queryByText(hint!) !== null);
      expect(rows, hint).toHaveLength(1);
    }
  });

  it('tanpa hasil menampilkan pesan kosong', async () => {
    const user = userEvent.setup();
    await renderScreen(<CommandPalette />);
    await input();
    await user.keyboard('zzqxjvk');
    expect(await screen.findByText(copy.palette.empty)).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('blur hanya di overlay; daftar hasil dan panel solid', async () => {
    await renderScreen(<CommandPalette />);
    await input();
    const dialog = screen.getByRole('dialog');
    const overlay = document.querySelector('[data-state="open"].aios-blur');
    expect(overlay).not.toBeNull();
    expect(overlay).not.toBe(dialog);
    expect(dialog.contains(overlay)).toBe(false);
    expect(dialog.className).not.toContain('aios-blur');
    expect(dialog.querySelector('.aios-blur')).toBeNull();
    expect(screen.getByRole('listbox').className).not.toContain('aios-blur');
    expect(dialog.className).toMatch(/bg-surface-[23]/);
    expect(dialog.className).toContain('rounded-sheet');
    expect(dialog.className).toContain('shadow-float');
    expect(dialog.className).toContain('aios-palette-in');
  });

  it('baris memakai tinggi minimal 36px', async () => {
    await renderScreen(<CommandPalette />);
    await input();
    for (const o of options()) expect(o.className).toContain('min-h-9');
  });
});
