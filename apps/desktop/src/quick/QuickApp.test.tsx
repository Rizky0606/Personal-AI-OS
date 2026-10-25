import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { TooltipProvider } from '../ui/Tooltip';
import type { QuickUpdate } from './protocol';
import { NO_MAIN_MS, QuickApp, type QuickChannel } from './QuickApp';

const q = copy.quick;
const CONV = '0192f0c4-7a1b-7c2d-8e3f-4a5b6c7d8e9f';

function fakeChannel() {
  let update: ((u: QuickUpdate) => void) | null = null;
  let shown: (() => void) | null = null;
  const ask = vi.fn();
  const open = vi.fn();
  const hide = vi.fn();
  const channel: QuickChannel = {
    ask,
    open,
    hide,
    onUpdate: (h) => {
      update = h;
      return () => (update = null);
    },
    onShown: (h) => {
      shown = h;
      return () => (shown = null);
    },
  };
  return {
    channel,
    ask,
    open,
    hide,
    push: (u: QuickUpdate) => act(() => update?.(u)),
    show: () => act(() => shown?.()),
    lastAskId: () => ask.mock.calls.at(-1)?.[0] as string,
  };
}

const renderApp = (channel: QuickChannel) =>
  render(
    <TooltipProvider>
      <QuickApp channel={channel} />
    </TooltipProvider>,
  );

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('QuickApp', () => {
  it('Enter mengirim pertanyaan; jawaban mengalir lalu Lanjutkan di chat membuka percakapan', async () => {
    const user = userEvent.setup();
    const f = fakeChannel();
    renderApp(f.channel);

    await user.type(screen.getByRole('textbox', { name: q.label }), 'Apa itu closure?{Enter}');
    expect(f.ask).toHaveBeenCalledWith(expect.any(String), 'Apa itu closure?');
    const id = f.lastAskId();

    f.push({ id, status: 'sending', conversationId: null, text: '' });
    expect(screen.getByRole('status')).toHaveTextContent(q.asking);
    expect(screen.getByRole('textbox', { name: q.label })).toBeDisabled();

    f.push({ id, status: 'streaming', conversationId: CONV, text: 'Closure adalah' });
    expect(screen.getByText('Closure adalah')).toBeInTheDocument();
    // Pembaruan untuk pertanyaan lain diabaikan.
    f.push({ id: 'lain', status: 'done', conversationId: CONV, text: 'Bukan ini' });
    expect(screen.queryByText('Bukan ini')).not.toBeInTheDocument();

    f.push({ id, status: 'done', conversationId: CONV, text: 'Closure adalah **fungsi**.' });
    await user.click(screen.getByRole('button', { name: q.continueInChat }));
    expect(f.open).toHaveBeenCalledWith(CONV);

    await user.click(screen.getByRole('button', { name: q.again }));
    expect(screen.getByRole('textbox', { name: q.label })).toHaveValue('');
  });

  it('galat dari jendela utama ditampilkan; Esc menyembunyikan jendela', async () => {
    const user = userEvent.setup();
    const f = fakeChannel();
    renderApp(f.channel);
    await user.type(screen.getByRole('textbox', { name: q.label }), 'Halo{Enter}');
    f.push({
      id: f.lastAskId(),
      status: 'error',
      conversationId: null,
      text: '',
      error: 'Server tidak terjangkau.',
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Server tidak terjangkau.');

    await user.keyboard('{Escape}');
    expect(f.hide).toHaveBeenCalled();
  });

  it('jendela utama diam: setelah batas waktu muncul petunjuk untuk membuka aplikasi utama', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const f = fakeChannel();
      renderApp(f.channel);
      await user.type(screen.getByRole('textbox', { name: q.label }), 'Halo{Enter}');
      act(() => {
        vi.advanceTimersByTime(NO_MAIN_MS + 10);
      });
      expect(screen.getByRole('alert')).toHaveTextContent(q.noMain);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offline: tidak mengirim dan menampilkan keterangan', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const user = userEvent.setup();
    const f = fakeChannel();
    renderApp(f.channel);
    expect(screen.getByText(copy.states.offline)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: q.label }), 'Halo{Enter}');
    expect(f.ask).not.toHaveBeenCalled();
  });
});
