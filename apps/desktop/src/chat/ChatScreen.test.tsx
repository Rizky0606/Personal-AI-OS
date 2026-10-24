import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';
import { CONV, RUN_1, RUN_2, message, models, roles, run } from '../test/fixtures';
import { api, emit, resetApi, runs } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { ChatScreen } = await import('./ChatScreen');

const page = (...items: ReturnType<typeof message>[]) => ({ items, nextBefore: null });

beforeEach(() => {
  resetApi();
  api.listRoles.mockResolvedValue(roles);
  api.listModels.mockResolvedValue(models);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  runs.release(RUN_1);
  runs.release(RUN_2);
});

const field = () => screen.getByRole('textbox', { name: copy.chat.composerLabel });

describe('ChatScreen: memuat riwayat', () => {
  it('skeleton saat memuat, lalu pesan pengguna, jawaban Markdown, dan langkah tool', async () => {
    let resolve: (value: ReturnType<typeof page>) => void = () => undefined;
    api.listMessages.mockReturnValue(new Promise((r) => (resolve = r)));
    await renderScreen(<ChatScreen conversationId={CONV} />);

    expect(screen.getByRole('status', { name: copy.chat.loadingMessages })).toBeInTheDocument();

    resolve(
      page(
        message({ author: 'user', text: 'Apa kabar?' }),
        message({
          author: 'assistant',
          agentRole: 'general',
          model: 'combo/fast',
          parts: [
            { type: 'tool', toolCallId: 't1', name: 'web.search', status: 'ok', durationMs: 1200 },
            { type: 'text', text: 'Jawabannya **jelas**.' },
          ],
        }),
      ),
    );

    expect(await screen.findByText('Apa kabar?')).toBeInTheDocument();
    expect(screen.getByText('jelas').tagName).toBe('STRONG');
    expect(screen.getByText('web.search')).toBeInTheDocument();
    expect(screen.getByText('1,2 dtk')).toBeInTheDocument();
    expect(screen.getByText('combo/fast')).toBeInTheDocument();
  });

  it('urutan waktu: isi halaman sudah kronologis, halaman lama (before) ditaruh di atas', async () => {
    api.listMessages
      .mockResolvedValueOnce({
        items: [
          message({ author: 'user', text: 'Pertanyaan kedua' }),
          message({ author: 'assistant', text: 'Jawaban kedua' }),
        ],
        nextBefore: 'kursor',
      })
      .mockResolvedValueOnce(
        page(
          message({ author: 'user', text: 'Pertanyaan pertama' }),
          message({ author: 'assistant', text: 'Jawaban pertama' }),
        ),
      );
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);
    await screen.findByText('Jawaban kedua');
    await user.click(screen.getByRole('button', { name: copy.chat.loadOlder }));
    await screen.findByText('Jawaban pertama');

    const log = screen.getByRole('log', { name: copy.chat.messages });
    const order = ['Pertanyaan pertama', 'Jawaban pertama', 'Pertanyaan kedua', 'Jawaban kedua'];
    const positions = order.map((text) => log.textContent.indexOf(text));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions).not.toContain(-1);
  });

  it('error memuat menampilkan pesan dengan langkah berikutnya dan Coba lagi memuat ulang', async () => {
    api.listMessages.mockRejectedValueOnce(new ApiProblem(0, 'network', 'x'));
    api.listMessages.mockResolvedValue(page(message({ author: 'user', text: 'Halo' })));
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.errors.network);
    await user.click(screen.getByRole('button', { name: copy.states.retry }));

    expect(await screen.findByText('Halo')).toBeInTheDocument();
  });

  it('percakapan baru: composer siap, saran tampil, tanpa sapaan besar', async () => {
    await renderScreen(<ChatScreen />);

    expect(field()).toHaveFocus();
    expect(screen.getByText(copy.chat.emptyThread)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: copy.chat.suggestions[0] as string }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.chat.send })).toBeDisabled();
  });
});

describe('ChatScreen: kirim dan alirkan jawaban', () => {
  it('Enter mengirim; jawaban mengalir dari run:<id>; Hentikan membatalkan run', async () => {
    api.listMessages.mockResolvedValue(page());
    const sent = message({ author: 'user', text: 'Tolong ringkas', runId: RUN_1 });
    api.sendMessage.mockResolvedValue({ message: sent, run: run({ id: RUN_1 }) });
    api.cancelRun.mockResolvedValue(run({ id: RUN_1, status: 'cancelled' }));
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    await user.type(field(), 'Tolong ringkas{Enter}');

    expect(api.sendMessage).toHaveBeenCalledWith(CONV, {
      text: 'Tolong ringkas',
      role: undefined,
      model: undefined,
    });
    expect(await screen.findByText('Tolong ringkas')).toBeInTheDocument();
    expect(field()).toHaveValue('');

    act(() => {
      emit(`run:${RUN_1}`, { type: 'run.status', status: 'running' });
      emit(`run:${RUN_1}`, { type: 'route.decided', role: 'writer', confidence: 0.8, reason: 'x' });
      emit(`run:${RUN_1}`, { type: 'message.delta', messageId: RUN_2, text: 'Ringkasan ' });
      emit(`run:${RUN_1}`, { type: 'message.delta', messageId: RUN_2, text: 'singkat.' });
    });

    expect(await screen.findByText('Ringkasan singkat.')).toBeInTheDocument();
    expect(screen.getByText('Penulis')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: copy.chat.stop }));
    expect(api.cancelRun).toHaveBeenCalledWith(RUN_1);

    act(() => emit(`run:${RUN_1}`, { type: 'run.status', status: 'cancelled' }));
    expect(await screen.findByRole('button', { name: copy.chat.send })).toBeInTheDocument();
  });

  it('Shift+Enter menambah baris, bukan mengirim', async () => {
    api.listMessages.mockResolvedValue(page());
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    await user.type(field(), 'baris satu{Shift>}{Enter}{/Shift}baris dua');

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(field()).toHaveValue('baris satu\nbaris dua');
  });

  it('gagal kirim: teks dikembalikan ke kolom dan toast menyebut langkah berikutnya', async () => {
    api.listMessages.mockResolvedValue(page());
    api.sendMessage.mockRejectedValue(new ApiProblem(503, 'down', 'x'));
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    await user.type(field(), 'Halo{Enter}');

    await waitFor(() => expect(field()).toHaveValue('Halo'));
    expect(await screen.findByText(new RegExp(copy.chat.sendFailed))).toBeInTheDocument();
  });

  it('offline: pesan tidak dikirim dan teks tetap di kolom', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    api.listMessages.mockResolvedValue(page());
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    await user.type(field(), 'Halo{Enter}');

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(field()).toHaveValue('Halo');
    expect(await screen.findByText(copy.chat.offlineSend)).toBeInTheDocument();
  });

  it('role dan model yang dipilih ikut terkirim, lalu role kembali otomatis', async () => {
    api.listMessages.mockResolvedValue(page());
    api.sendMessage.mockResolvedValue({
      message: message({ author: 'user', text: 'x', runId: RUN_1 }),
      run: run({ id: RUN_1 }),
    });
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    await user.click(
      await screen.findByRole('button', { name: new RegExp(`${copy.chat.role.label}:`) }),
    );
    await user.click(await screen.findByRole('menuitemradio', { name: 'Penulis' }));
    await user.click(screen.getByRole('button', { name: new RegExp(`${copy.chat.model.label}:`) }));
    await user.click(await screen.findByRole('menuitemradio', { name: /^Cepat/ }));
    await user.type(field(), 'x{Enter}');

    expect(api.sendMessage).toHaveBeenCalledWith(CONV, {
      text: 'x',
      role: 'writer',
      model: 'combo/fast',
    });
    expect(
      screen.getByRole('button', { name: `${copy.chat.role.label}: ${copy.chat.role.auto}` }),
    ).toBeInTheDocument();
  });
});

describe('ChatScreen: ubah pesan terakhir dan jalankan ulang', () => {
  const history = () =>
    page(
      message({ author: 'user', text: 'Pertanyaan saya', runId: RUN_1 }),
      message({ author: 'assistant', agentRole: 'general', runId: RUN_1, text: 'Jawaban lama' }),
    );

  it('Ubah pesan terakhir memindahkan teksnya ke kolom pesan untuk dikirim sebagai pesan baru', async () => {
    api.listMessages.mockResolvedValue(history());
    api.getRun.mockResolvedValue(run({ id: RUN_1, status: 'completed' }));
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    await user.click(await screen.findByRole('button', { name: copy.chat.editLast }));

    expect(field()).toHaveValue('Pertanyaan saya');
    expect(field()).toHaveFocus();
  });

  it('Kirim ulang di bawah pesan terakhir mengirim teks yang sama tanpa menyentuh draf', async () => {
    api.listMessages.mockResolvedValue(history());
    api.getRun.mockResolvedValue(run({ id: RUN_1, status: 'completed' }));
    api.sendMessage.mockResolvedValue({
      message: message({ author: 'user', text: 'Pertanyaan saya', runId: RUN_2 }),
      run: run({ id: RUN_2 }),
    });
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    const last = (await screen.findByText('Pertanyaan saya')).closest('article')!;
    await user.type(field(), 'draf');
    await user.click(within(last).getByRole('button', { name: copy.chat.resend }));

    expect(api.sendMessage).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ text: 'Pertanyaan saya' }),
    );
    expect(field()).toHaveValue('draf');
  });

  it('Ubah membuka editor di tempat; Kirim memotong dari pesan itu dan jawaban lama hilang', async () => {
    const data = history();
    api.listMessages.mockResolvedValue(data);
    api.getRun.mockResolvedValue(run({ id: RUN_1, status: 'completed' }));
    api.editMessage.mockResolvedValue({
      message: message({ author: 'user', text: 'Pertanyaan baru', runId: RUN_2 }),
      run: run({ id: RUN_2 }),
    });
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    const mine = (await screen.findByText('Pertanyaan saya')).closest('article')!;
    await user.click(within(mine).getByRole('button', { name: copy.chat.edit }));
    const editor = screen.getByRole('textbox', { name: copy.chat.editLabel });
    expect(editor).toHaveValue('Pertanyaan saya');
    await user.clear(editor);
    await user.type(editor, 'Pertanyaan baru{Enter}');

    expect(api.editMessage).toHaveBeenCalledWith(
      data.items[0]?.id,
      expect.objectContaining({ text: 'Pertanyaan baru' }),
    );
    expect(await screen.findByText('Pertanyaan baru')).toBeInTheDocument();
    expect(screen.queryByText('Pertanyaan saya')).not.toBeInTheDocument();
    expect(screen.queryByText('Jawaban lama')).not.toBeInTheDocument();
    runs.release(RUN_2);
  });

  it('Hapus meminta konfirmasi lalu membuang pesan itu dan sesudahnya', async () => {
    const data = history();
    api.listMessages.mockResolvedValueOnce(data).mockResolvedValue(page());
    api.getRun.mockResolvedValue(run({ id: RUN_1, status: 'completed' }));
    api.deleteMessage.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    const mine = (await screen.findByText('Pertanyaan saya')).closest('article')!;
    await user.click(within(mine).getByRole('button', { name: copy.chat.deleteMessage }));
    const dialog = await screen.findByRole('dialog', { name: copy.chat.deleteMessageTitle });
    await user.click(within(dialog).getByRole('button', { name: copy.chat.deleteMessageConfirm }));

    expect(api.deleteMessage).toHaveBeenCalledWith(data.items[0]?.id);
    await waitFor(() => expect(screen.queryByText('Jawaban lama')).not.toBeInTheDocument());
    expect(screen.queryByText('Pertanyaan saya')).not.toBeInTheDocument();
  });

  it('Hapus dibatalkan: tidak ada yang dihapus', async () => {
    api.listMessages.mockResolvedValue(history());
    api.getRun.mockResolvedValue(run({ id: RUN_1, status: 'completed' }));
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    const answer = (await screen.findByText('Jawaban lama')).closest('article')!;
    await user.click(within(answer).getByRole('button', { name: copy.chat.deleteMessage }));
    const dialog = await screen.findByRole('dialog', { name: copy.chat.deleteMessageTitle });
    await user.click(within(dialog).getByRole('button', { name: copy.chat.cancel }));

    expect(api.deleteMessage).not.toHaveBeenCalled();
    expect(screen.getByText('Jawaban lama')).toBeInTheDocument();
  });

  it('chip role pada jawaban terakhir menjalankan ulang dengan role lain', async () => {
    const data = history();
    api.listMessages.mockResolvedValue(data);
    api.getRun.mockResolvedValue(run({ id: RUN_1, status: 'completed' }));
    api.rerouteMessage.mockResolvedValue({ run: run({ id: RUN_2 }), correction: {} as never });
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    const answer = (await screen.findByText('Jawaban lama')).closest('article')!;
    await user.click(
      within(answer).getByRole('button', { name: new RegExp(copy.chat.role.rerun) }),
    );
    await user.click(await screen.findByRole('menuitemradio', { name: 'Penulis' }));

    expect(api.rerouteMessage).toHaveBeenCalledWith(data.items[1]?.id, 'writer');
  });

  it('melanjutkan jawaban yang masih berjalan saat percakapan dibuka', async () => {
    const OPEN_RUN = '0192f0c4-7a1b-7c2d-b002-4a5b6c7d8e92';
    api.listMessages.mockResolvedValue(
      page(message({ author: 'user', text: 'Masih jalan', runId: OPEN_RUN })),
    );
    api.getRun.mockResolvedValue(run({ id: OPEN_RUN, status: 'running' }));
    await renderScreen(<ChatScreen conversationId={CONV} />);

    await waitFor(() => expect(runs.get(OPEN_RUN)).toBeDefined());
    act(() =>
      emit(`run:${OPEN_RUN}`, { type: 'message.delta', messageId: RUN_2, text: 'Lanjutan' }),
    );

    expect(await screen.findByText('Lanjutan')).toBeInTheDocument();
    runs.release(OPEN_RUN);
  });

  it('kegagalan run tampil sebagai banner error', async () => {
    api.listMessages.mockResolvedValue(page());
    api.sendMessage.mockResolvedValue({
      message: message({ author: 'user', text: 'x', runId: RUN_1 }),
      run: run({ id: RUN_1 }),
    });
    const user = userEvent.setup();
    await renderScreen(<ChatScreen conversationId={CONV} />);

    await user.type(field(), 'x{Enter}');
    await screen.findByText('x');
    act(() => {
      emit(`run:${RUN_1}`, {
        type: 'error',
        code: 'upstream',
        message: 'Model tidak tersedia',
        retryable: true,
      });
      emit(`run:${RUN_1}`, { type: 'run.status', status: 'failed' });
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `${copy.chat.runFailed} Model tidak tersedia`,
    );
  });
});
