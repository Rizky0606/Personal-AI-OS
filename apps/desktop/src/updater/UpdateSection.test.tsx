import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { renderScreen } from '../test/render';

const checkForUpdate = vi.fn();
vi.mock('./checkForUpdate', () => ({ checkForUpdate: () => checkForUpdate() as unknown }));

const { UpdateSection } = await import('./UpdateSection');
const text = copy.settings.update;

beforeEach(() => {
  checkForUpdate.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('UpdateSection', () => {
  it('menyatakan aplikasi sudah terbaru', async () => {
    checkForUpdate.mockResolvedValue({ kind: 'current' });
    await renderScreen(<UpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: text.check }));
    expect(await screen.findByText(text.current)).toBeInTheDocument();
  });

  it('menawarkan pemasangan versi baru lalu memasangnya', async () => {
    const install = vi.fn().mockResolvedValue(undefined);
    checkForUpdate.mockResolvedValue({ kind: 'available', version: '1.0.1', install });
    await renderScreen(<UpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: text.check }));
    await userEvent.click(await screen.findByRole('button', { name: text.install }));
    expect(install).toHaveBeenCalledTimes(1);
    expect(screen.getByText(text.installing('1.0.1'))).toBeInTheDocument();
  });

  it('menjelaskan bila pemeriksaan gagal, dan di luar aplikasi desktop', async () => {
    checkForUpdate.mockRejectedValueOnce(new Error('jaringan'));
    await renderScreen(<UpdateSection />);
    await userEvent.click(screen.getByRole('button', { name: text.check }));
    expect(await screen.findByText(text.error)).toBeInTheDocument();

    checkForUpdate.mockResolvedValueOnce({ kind: 'unavailable' });
    await userEvent.click(screen.getByRole('button', { name: text.check }));
    expect(await screen.findByText(text.unavailable)).toBeInTheDocument();
  });

  it('offline: tombol nonaktif dengan penjelasan', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await renderScreen(<UpdateSection />);
    expect(screen.getByRole('button', { name: text.check })).toBeDisabled();
    expect(screen.getByText(text.offline)).toBeInTheDocument();
  });
});
