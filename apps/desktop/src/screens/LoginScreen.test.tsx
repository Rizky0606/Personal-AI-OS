import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '../auth/authSession';
import { copy } from '../copy';

/**
 * Perekam panggilan (vi.fn, tanpa nilai kembalian) dipisah dari implementasi biasa: pembungkus mock Vitest
 * melacak promise yang dikembalikan dan membuat promise turunan yang ikut menolak tanpa penangan.
 */
const login = vi.hoisted(() => vi.fn());
const impl = vi.hoisted((): { run: (...args: unknown[]) => Promise<void> } => ({
  run: () => Promise.resolve(),
}));
// getState harus mengembalikan objek yang sama tiap panggilan (kontrak useSyncExternalStore).
const signedOut = vi.hoisted(() => ({ status: 'signedOut' as const }));
const idle = vi.hoisted(() => ({ kind: 'idle' as const }));

vi.mock('../app/services', () => ({
  auth: {
    login: (...args: unknown[]) => {
      login(...args);
      return impl.run(...args);
    },
    subscribe: () => () => undefined,
    getState: () => signedOut,
  },
  realtime: { subscribeState: () => () => undefined, getState: () => idle },
}));

const { LoginScreen } = await import('./LoginScreen');

const fields = () => ({
  server: screen.getByLabelText(copy.login.server),
  password: screen.getByLabelText(copy.login.password),
  totp: screen.getByLabelText(copy.login.totp),
  submit: screen.getByRole('button', { name: copy.login.submit }),
});

beforeEach(() => {
  login.mockReset();
  impl.run = () => Promise.resolve();
});

describe('LoginScreen', () => {
  it('satu layar: alamat server, password, TOTP, dan tombol Masuk; alamat terakhir terisi', () => {
    render(<LoginScreen initialServer="https://aios.contoh.com" />);
    const f = fields();
    expect(f.server).toHaveValue('https://aios.contoh.com');
    expect(f.password).toHaveAttribute('type', 'password');
    expect(f.totp).toHaveAttribute('inputmode', 'numeric');
  });

  it('password kosong dan TOTP pendek ditolak lokal tanpa memanggil server', async () => {
    const user = userEvent.setup();
    render(<LoginScreen initialServer="https://aios.contoh.com" />);

    await user.type(fields().totp, '123');
    await user.click(fields().submit);

    expect(screen.getByText(copy.login.errors.passwordEmpty)).toBeInTheDocument();
    expect(screen.getByText(copy.login.errors.totpFormat)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('TOTP hanya menerima digit (maks. 6) dan login dipanggil dengan nilai yang benar', async () => {
    const user = userEvent.setup();
    render(<LoginScreen initialServer="https://aios.contoh.com" />);

    await user.type(fields().password, 'rahasia-panjang');
    await user.type(fields().totp, '12 34-5678');
    expect(fields().totp).toHaveValue('123456');
    await user.click(fields().submit);

    expect(login).toHaveBeenCalledWith('https://aios.contoh.com', 'rahasia-panjang', '123456');
    await waitFor(() => expect(fields().password).toHaveValue(''));
  });

  it('kredensial salah menampilkan pesan dengan langkah berikutnya dan form tetap bisa dipakai', async () => {
    impl.run = () => Promise.reject(new ApiProblem(401, 'invalid_credentials', 'x'));
    const user = userEvent.setup();
    render(<LoginScreen initialServer="https://aios.contoh.com" />);

    await user.type(fields().password, 'salah');
    await user.type(fields().totp, '123456');
    await user.click(fields().submit);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      copy.login.errors.invalidCredentials,
    );
    expect(fields().submit).toBeEnabled();
  });

  it('saat memeriksa, tombol berubah dan tidak bisa dikirim dua kali', async () => {
    let finish: () => void = () => undefined;
    impl.run = () => new Promise<void>((resolve) => (finish = resolve));
    const user = userEvent.setup();
    render(<LoginScreen initialServer="https://aios.contoh.com" />);

    await user.type(fields().password, 'rahasia-panjang');
    await user.type(fields().totp, '123456');
    await user.click(fields().submit);

    const busy = await screen.findByRole('button', { name: copy.login.submitting });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(login).toHaveBeenCalledTimes(1);
    finish();
  });

  it('password bisa ditampilkan lewat tombol bernama jelas', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: 'Tampilkan password' }));

    expect(fields().password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Sembunyikan password' })).toBeInTheDocument();
  });
});
