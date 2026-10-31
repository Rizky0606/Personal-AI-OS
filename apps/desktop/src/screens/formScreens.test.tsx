import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../copy';
import { api, resetApi } from '../test/fakeServices';
import { renderScreen } from '../test/render';

vi.mock('../app/services', async () => (await import('../test/fakeServices')).fakeServices);

const { CompareScreen } = await import('../compare/CompareScreen');
const { ResearchFormScreen } = await import('../research/ResearchFormScreen');
const { SpacesScreen } = await import('../spaces/SpacesScreen');

beforeEach(() => {
  resetApi();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('layar formulir: keadaan memuat, kosong, error, dan offline', () => {
  it('Banding: memuat daftar model menampilkan kerangka berlabel di bawah satu judul', async () => {
    api.listModels.mockReturnValue(new Promise(() => undefined));
    await renderScreen(<CompareScreen />, '/compare');

    expect(
      await screen.findByRole('status', { name: copy.compare.modelsLoading }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('Riset baru: mengirim menonaktifkan tombol dan mengganti labelnya; gagal tidak mengunci form', async () => {
    const user = userEvent.setup();
    // Promise.withResolvers belum ada di lib TS proyek (target < ES2024).
    let reject: (reason: unknown) => void = () => undefined;
    api.createResearch.mockReturnValue(
      new Promise((_resolve, rej) => {
        reject = rej;
      }),
    );
    await renderScreen(<ResearchFormScreen />, '/research');

    await user.type(screen.getByLabelText(copy.research.form.question), 'Bun atau Node?');
    await user.click(screen.getByRole('button', { name: copy.research.form.submit }));
    expect(
      await screen.findByRole('button', { name: copy.research.form.submitting }),
    ).toBeDisabled();

    reject(new Error('gagal'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: copy.research.form.submit })).toBeEnabled(),
    );
    expect(screen.getByLabelText(copy.research.form.question)).toHaveValue('Bun atau Node?');
  });

  it('Ruang: offline menonaktifkan pembuatan dan menjelaskan alasannya', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await renderScreen(<SpacesScreen />, '/spaces');

    expect(await screen.findByText(copy.states.offline)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.spaces.create })).toBeDisabled();
    expect(screen.getByRole('heading', { level: 2, name: copy.spaces.title })).toBeInTheDocument();
  });
});
