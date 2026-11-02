import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { TooltipProvider } from '../ui/Tooltip';
import { Composer, type ComposerProps } from './Composer';

const base: ComposerProps = {
  draft: 'halo',
  onDraft: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  streaming: false,
  sending: false,
  models: [],
  model: null,
  onModel: vi.fn(),
  canEditLast: false,
  onEditLast: vi.fn(),
  focusNonce: 0,
};
const ui = (props: Partial<ComposerProps>) => (
  <TooltipProvider>
    <Composer {...base} {...props} />
  </TooltipProvider>
);

describe('Composer: kirim/hentikan', () => {
  it('satu tombol yang sama berubah label dan aksi saat streaming', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onStop = vi.fn();
    const view = render(ui({ onSend, onStop }));
    const button = screen.getByRole('button', { name: copy.chat.send });
    await user.click(button);
    expect(onSend).toHaveBeenCalledOnce();

    view.rerender(ui({ onSend, onStop, streaming: true }));
    const stop = screen.getByRole('button', { name: copy.chat.stop });
    expect(stop).toBe(button);
    await user.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('bingkai membawa fase run untuk pewarnaan', () => {
    const view = render(ui({ phase: 'tool', streaming: true }));
    expect(view.container.querySelector('[data-phase="tool"]')).not.toBeNull();
  });
});

describe('Composer: pemilih model', () => {
  const models = [{ id: 'combo/fast', label: 'Cepat', kind: 'combo' as const, ownedBy: '9router' }];

  it('mesin yang mendukung pilihan model: pemilih aktif dan bisa dibuka', async () => {
    const user = userEvent.setup();
    render(ui({ models }));
    const picker = screen.getByRole('button', { name: new RegExp(`^${copy.chat.model.label}: `) });
    expect(picker).toBeEnabled();
    await user.click(picker);
    expect(await screen.findByRole('menuitemradio', { name: /Cepat/ })).toBeInTheDocument();
  });

  it('Hermes (mesin tanpa pilihan model): pemilih nonaktif dengan keterangan, tidak bisa dibuka', async () => {
    const user = userEvent.setup();
    const onModel = vi.fn();
    render(
      ui({ models, onModel, model: 'combo/fast', modelLockedReason: copy.chat.model.hermesFixed }),
    );
    expect(copy.chat.model.hermesFixed).toBe('Model diatur di server Hermes');
    const picker = screen.getByRole('button', {
      name: `${copy.chat.model.label}: ${copy.chat.model.hermesFixed}`,
    });
    expect(picker).toBeDisabled();
    expect(picker).toHaveTextContent(copy.chat.model.hermesFixed);
    expect(picker).toHaveAttribute('title', copy.chat.model.hermesFixed);
    // Pilihan lama tidak tampil seolah berlaku, dan menu tidak terbuka.
    expect(screen.queryByText('Cepat')).not.toBeInTheDocument();
    await user.click(picker);
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
    expect(onModel).not.toHaveBeenCalled();
  });
});
