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

  it('alamat tertanam saat build: isian alamat disembunyikan dan login memakai alamat itu', async () => {
    const user = userEvent.setup();
    render(
      <LoginScreen initialServer="https://lama.contoh.com" fixedServer="https://ai.contoh.com" />,
    );

    expect(screen.queryByLabelText(copy.login.server)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(copy.login.password), 'rahasia-panjang');
    await user.type(screen.getByLabelText(copy.login.totp), '123456');
    await user.click(screen.getByRole('button', { name: copy.login.submit }));

    expect(login).toHaveBeenCalledWith('https://ai.contoh.com', 'rahasia-panjang', '123456');
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

  it('tombol tampilkan/sembunyikan ada di dalam ruas input (satu pembungkus), bukan di samping', () => {
    render(<LoginScreen />);

    const { password } = fields();
    const toggle = screen.getByRole('button', { name: 'Tampilkan password' });

    expect(password.parentElement).toContainElement(toggle);
    // Tidak ada margin penyeimbang label/catatan seperti sebelumnya (mb-5).
    expect(toggle.className).not.toMatch(/\bmb-/);
    // Input memberi ruang di kanan agar teks tidak tertutup tombol.
    expect(password.className).toMatch(/\bpr-10\b/);
    // Pembungkus ruas tidak berada dalam baris flex yang membuatnya menyusut menjadi setengah lebar.
    expect(password.closest('form')?.querySelector('.items-end')).toBeNull();
  });

  it('keyboard: Tab dari password ke tombol tampilkan lalu ke kode TOTP; Spasi dan Enter menukar tampilan', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(fields().password);
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Tampilkan password' });
    expect(toggle).toHaveFocus();

    await user.keyboard(' ');
    expect(fields().password).toHaveAttribute('type', 'text');
    await user.keyboard('{Enter}');
    expect(fields().password).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Tampilkan password' })).toHaveFocus();

    await user.tab();
    expect(fields().totp).toHaveFocus();
  });

  it('state error: pesan password tampil, input ditandai tidak valid, tombol tampilkan tetap di dalam ruas', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(fields().totp, '123456');
    await user.click(fields().submit);

    const { password } = fields();
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAccessibleDescription(copy.login.errors.passwordEmpty);
    expect(password.parentElement).toContainElement(
      screen.getByRole('button', { name: 'Tampilkan password' }),
    );
  });

  it('saat memeriksa, input password dinonaktifkan dan tombol tampilkan tetap ada', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => undefined;
    impl.run = () => new Promise<void>((resolve) => (finish = resolve));
    render(<LoginScreen />);

    await user.type(fields().password, 'rahasia');
    await user.type(fields().totp, '123456');
    await user.click(fields().submit);

    const password = await screen.findByLabelText(copy.login.password);
    await waitFor(() => expect(password).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Tampilkan password' })).toBeInTheDocument();
    finish();
    await waitFor(() => expect(password).not.toBeDisabled());
  });
});
