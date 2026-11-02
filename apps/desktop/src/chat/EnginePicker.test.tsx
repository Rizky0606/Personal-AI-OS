import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EngineInfo } from '@aios/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { useUiStore } from '../state/uiStore';
import { CONV, RUN_1, message, models, roles, run } from '../test/fixtures';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { ChatScreen } = await import('./ChatScreen');

const PROJECT = '0192f0c4-7a1b-7c2d-a001-4a5b6c7d8e91';
const OTHER = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e77';
const TS = '2026-10-24T00:00:00.000Z';

const report = (over: Partial<Record<'omp' | 'dsh', Partial<EngineInfo>>> = {}): EngineInfo[] => [
  {
    id: 'hermes',
    label: 'Hermes',
    available: true,
    experimental: false,
    supportsModelPick: false,
    supportsTodo: false,
  },
  {
    id: 'omp',
    label: 'omp',
    available: true,
    experimental: false,
    supportsModelPick: true,
    supportsTodo: true,
    ...over.omp,
  },
  {
    id: 'dsh',
    label: 'dsh',
    available: true,
    experimental: true,
    supportsModelPick: true,
    supportsTodo: false,
    ...over.dsh,
  },
];

const page = (...items: ReturnType<typeof message>[]) => ({ items, nextBefore: null });
const field = () => screen.getByRole('textbox', { name: copy.chat.composerLabel });
const enginePill = () =>
  screen.findByRole('button', { name: new RegExp(`^${copy.chat.engine.label}:`) });

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState(), true);
  api.listRoles.mockResolvedValue(roles);
  api.listModels.mockResolvedValue(models);
  api.listEngines.mockResolvedValue(report());
  api.listMessages.mockResolvedValue(page());
  api.sendMessage.mockResolvedValue({
    message: message({ author: 'user', text: 'x', runId: RUN_1 }),
    run: run({ id: RUN_1 }),
  });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('pemilih mesin di composer', () => {
  it('chat umum: Otomatis, Hermes, dsh bisa dipilih; omp nonaktif dengan alasan; dsh berlabel Pratinjau', async () => {
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await user.click(await enginePill());

    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      copy.chat.engine.auto,
      `omp${copy.chat.engine.needsProject}`,
      'Hermes',
      `dsh${copy.chat.engine.previewHint}${copy.chat.engine.preview}`,
    ]);
    expect(items[1]).toHaveAttribute('aria-disabled', 'true');
    expect(items[0]).not.toHaveAttribute('aria-disabled', 'true');
    expect(items[2]).not.toHaveAttribute('aria-disabled', 'true');
    expect(items[3]).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('dsh tidak tersedia di server: tampil nonaktif dengan alasan dari gateway dan tidak bisa dipilih', async () => {
    api.listEngines.mockResolvedValue(
      report({
        dsh: { available: false, reason: 'Belum dikonfigurasi di server (DSH_COMMAND kosong).' },
      }),
    );
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await user.click(await enginePill());

    const dsh = await screen.findByRole('menuitemradio', { name: /^dsh/ });
    expect(dsh).toHaveAttribute('aria-disabled', 'true');
    expect(dsh).toHaveTextContent('Belum dikonfigurasi di server (DSH_COMMAND kosong).');
    await user.click(dsh);
    expect(useUiStore.getState().engineByConversation).toEqual({});
  });

  it('memilih dsh: pesan terkirim dengan engine "dsh", dipilih ditandai Pratinjau dengan tooltip belum diaudit', async () => {
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await user.click(await enginePill());
    await user.click(await screen.findByRole('menuitemradio', { name: /^dsh/ }));

    const pill = await enginePill();
    expect(pill).toHaveAccessibleName(`${copy.chat.engine.label}: dsh`);
    expect(pill).toHaveAttribute('title', copy.chat.engine.previewHint);
    expect(pill).toHaveTextContent(copy.chat.engine.preview);

    await user.type(field(), 'tugas{Enter}');
    expect(api.sendMessage).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ text: 'tugas', engine: 'dsh' }),
    );
  });

  it('Hermes dipilih sendiri di project: terkirim sebagai engine "hermes", model dikunci', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await user.click(await enginePill());
    await user.click(await screen.findByRole('menuitemradio', { name: /^Hermes/ }));
    expect(
      await screen.findByRole('button', {
        name: `${copy.chat.model.label}: ${copy.chat.model.hermesFixed}`,
      }),
    ).toBeDisabled();
    await user.type(field(), 'tanya{Enter}');
    expect(api.sendMessage).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ text: 'tanya', engine: 'hermes' }),
    );
  });

  it('Otomatis tidak mengirim field engine', async () => {
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await user.type(field(), 'halo{Enter}');
    const sent = api.sendMessage.mock.calls[0]![1];
    expect(sent.engine).toBeUndefined();
  });

  it('pilihan tersimpan per percakapan dan kembali saat percakapan dibuka lagi', async () => {
    const user = userEvent.setup();
    const first = await renderScreen(<ChatScreen conversationId={CONV} />);
    await user.click(await enginePill());
    await user.click(await screen.findByRole('menuitemradio', { name: /^dsh/ }));
    expect(useUiStore.getState().engineByConversation).toEqual({ [CONV]: 'dsh' });
    first.unmount();

    // Percakapan lain tidak ikut berubah.
    const second = await renderScreen(<ChatScreen conversationId={OTHER} />);
    expect(await enginePill()).toHaveAccessibleName(
      `${copy.chat.engine.label}: ${copy.chat.engine.auto}`,
    );
    second.unmount();

    // Dibuka lagi: pilihan dsh kembali.
    await renderScreen(<ChatScreen conversationId={CONV} />);
    expect(await enginePill()).toHaveAccessibleName(`${copy.chat.engine.label}: dsh`);
  });

  it('chat baru: pilihan dipindah ke percakapan yang baru dibuat dan kunci sementara dibersihkan', async () => {
    api.createConversation.mockResolvedValue({
      id: CONV,
      title: '',
      surface: 'windows',
      projectId: null,
      spaceId: null,
      pinned: false,
      archivedAt: null,
      createdAt: TS,
      updatedAt: TS,
    });
    const user = userEvent.setup();
    await renderScreen(<ChatScreen />);
    await user.click(await enginePill());
    await user.click(await screen.findByRole('menuitemradio', { name: /^dsh/ }));
    expect(useUiStore.getState().engineByConversation).toEqual({ baru: 'dsh' });

    await user.type(field(), 'tugas{Enter}');
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(api.sendMessage).toHaveBeenCalledWith(CONV, expect.objectContaining({ engine: 'dsh' }));
    expect(useUiStore.getState().engineByConversation).toEqual({ [CONV]: 'dsh' });
  });

  it('di project: omp dan Hermes bisa dipilih; dsh nonaktif karena hanya untuk chat umum', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await user.click(await enginePill());

    expect(await screen.findByRole('menuitemradio', { name: /^omp/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: /^Hermes/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    const dsh = screen.getByRole('menuitemradio', { name: /^dsh/ });
    expect(dsh).toHaveAttribute('aria-disabled', 'true');
    expect(dsh).toHaveTextContent(copy.chat.engine.generalOnly);
  });

  it('di project dengan worker mati: omp nonaktif dengan alasan dari gateway', async () => {
    useUiStore.getState().setActiveProject(PROJECT);
    api.listEngines.mockResolvedValue(
      report({ omp: { available: false, reason: 'Tidak ada worker Windows yang tersambung.' } }),
    );
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await user.click(await enginePill());

    const omp = await screen.findByRole('menuitemradio', { name: /^omp/ });
    expect(omp).toHaveAttribute('aria-disabled', 'true');
    expect(omp).toHaveTextContent('Tidak ada worker Windows yang tersambung.');
  });

  it('pemilih model mengikuti kemampuan mesin: Hermes terkunci, dsh membuka pemilih model', async () => {
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    const locked = await screen.findByRole('button', {
      name: `${copy.chat.model.label}: ${copy.chat.model.hermesFixed}`,
    });
    expect(locked).toBeDisabled();

    await user.click(await enginePill());
    await user.click(await screen.findByRole('menuitemradio', { name: /^dsh/ }));
    const open = await screen.findByRole('button', {
      name: new RegExp(`^${copy.chat.model.label}: ${copy.chat.model.auto}`),
    });
    expect(open).toBeEnabled();
  });
});
