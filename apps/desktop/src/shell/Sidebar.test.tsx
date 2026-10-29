import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { Sidebar } = await import('./Sidebar');

const NAMES = [
  copy.nav.chat,
  copy.nav.workspace,
  copy.nav.kanban,
  copy.nav.schedules,
  copy.nav.research,
  copy.nav.spaces,
  copy.nav.settings,
];

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
});

const renderSidebar = (path = '/kanban') =>
  renderScreen(
    <Sidebar title="Daftar kartu">
      <p>isi daftar konteks</p>
    </Sidebar>,
    path,
  );
const nav = () => screen.getByRole('navigation', { name: copy.shell.rail });
const link = (name: string) => within(nav()).getByRole('link', { name });

describe('Sidebar (pulau)', () => {
  it('navigasi utama: 7 tujuan berurutan dengan ikon + label; hanya yang aktif punya aria-current=page', async () => {
    await renderSidebar('/kanban');

    expect(
      within(nav())
        .getAllByRole('link')
        .map((a) => a.getAttribute('aria-label')),
    ).toEqual(NAMES);
    for (const name of NAMES) {
      if (name === copy.nav.kanban) expect(link(name)).toHaveAttribute('aria-current', 'page');
      else expect(link(name)).not.toHaveAttribute('aria-current');
    }
    // Label terlihat di mode lebar (bukan sr-only), ikon tersembunyi dari pembaca layar.
    expect(within(link(copy.nav.kanban)).getByText(copy.nav.kanban)).not.toHaveClass('sr-only');
    expect(link(copy.nav.kanban).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('tab project aktif untuk /workspace; chat aktif untuk "/"', async () => {
    const view = await renderSidebar('/workspace');
    expect(link(copy.nav.workspace)).toHaveAttribute('aria-current', 'page');
    view.unmount();

    await renderSidebar('/');
    expect(link(copy.nav.chat)).toHaveAttribute('aria-current', 'page');
    expect(link(copy.nav.workspace)).not.toHaveAttribute('aria-current');
  });

  it('keyboard: panah atas/bawah berputar antar item, Home dan End ke ujung; Enter membuka tujuan', async () => {
    const user = userEvent.setup();
    const { router } = await renderSidebar('/kanban');

    link(copy.nav.chat).focus();
    await user.keyboard('{ArrowDown}');
    expect(link(copy.nav.workspace)).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    // Dari Chat ke atas: berputar ke item terakhir.
    expect(link(copy.nav.settings)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(link(copy.nav.chat)).toHaveFocus();
    await user.keyboard('{End}');
    expect(link(copy.nav.settings)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(link(copy.nav.chat)).toHaveFocus();

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(router.state.location.pathname).toBe('/kanban');
  });

  it('Tab tetap menelusuri item satu per satu (semua bisa dijangkau tanpa panah)', async () => {
    const user = userEvent.setup();
    await renderSidebar();

    await user.tab();
    expect(link(copy.nav.chat)).toHaveFocus();
    await user.tab();
    expect(link(copy.nav.workspace)).toHaveFocus();
  });

  it('daftar konteks tampil dengan judul bagian saat lebar', async () => {
    await renderSidebar();

    expect(screen.getByRole('heading', { level: 2, name: 'Daftar kartu' })).toBeInTheDocument();
    expect(screen.getByText('isi daftar konteks')).toBeInTheDocument();
  });

  it('ringkas: hanya ikon; label tetap jadi nama aksesibel dan muncul sebagai tooltip saat fokus; daftar konteks hilang', async () => {
    useUiStore.setState({ sidebarOpen: false });
    await renderSidebar();

    const aside = screen.getByRole('complementary', { name: copy.shell.sidebar });
    expect(aside).toHaveAttribute('data-compact', 'true');
    expect(screen.queryByText('isi daftar konteks')).not.toBeInTheDocument();
    expect(within(link(copy.nav.kanban)).getByText(copy.nav.kanban)).toHaveClass('sr-only');

    link(copy.nav.schedules).focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(copy.nav.schedules);
  });

  it('lebar: tanpa tooltip saat fokus (label sudah terlihat)', async () => {
    await renderSidebar();

    link(copy.nav.schedules).focus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('tombol ciutkan/buka di sidebar mengubah mode dan nama tombolnya', async () => {
    const user = userEvent.setup();
    await renderSidebar();

    await user.click(screen.getByRole('button', { name: copy.shell.collapseSidebar }));
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    expect(screen.getByRole('complementary', { name: copy.shell.sidebar })).toHaveAttribute(
      'data-compact',
      'true',
    );

    await user.click(screen.getByRole('button', { name: copy.shell.expandSidebar }));
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });
});
