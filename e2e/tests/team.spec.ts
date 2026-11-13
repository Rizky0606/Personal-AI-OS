import { control, expect, login, prepare, test } from './fixtures';
import { SCENARIO_TEAM, TEAM_TASK_1, TEAM_TASK_2 } from '../harness/fakes';

/**
 * e2e tim Orca (ORCA_DESIGN.md P7, tugas 11): "Kerjakan sebagai tim" di composer -> Lead (Hermes
 * palsu) merencanakan 2 tugas -> Worker (omp SUNGGUHAN, model palsu sama dengan coding.spec.ts)
 * mengerjakan keduanya berurutan -> Lead meninjau dan menerima kedua kalinya -> tim selesai, TIDAK
 * ada yang digabung otomatis ke branch kerja pengguna (keputusan pemilik tetap di luar tim).
 */
test('tim Orca: rencana 2 tugas -> Worker mengerjakan berurutan -> Lead terima -> tim selesai, tidak auto-merge', async ({
  page,
}) => {
  test.setTimeout(240_000);
  test.skip(!(await control.hasOmp()), 'omp tidak terpasang di mesin ini');
  const repo = await control.repo();
  const mainBefore = await control.git(repo, 'rev-parse', 'main');
  await prepare(page, { pickFolder: repo });
  await login(page);

  // Daftarkan project (sama seperti coding.spec.ts).
  await page.keyboard.press('Control+2');
  await page.getByRole('link', { name: 'Kelola project' }).click();
  await page.getByRole('button', { name: 'Tambah project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Tambah project' });
  await dialog.getByRole('button', { name: 'Pilih folder' }).click();
  await dialog.getByRole('button', { name: 'Izinkan folder ini' }).click();
  await dialog.getByRole('button', { name: 'Daftarkan project' }).click();
  await expect(page.getByText('Project terdaftar.').first()).toBeVisible();

  await page.keyboard.press('Control+2');
  await page.getByRole('list', { name: 'Daftar project' }).getByRole('link').first().click();

  // Nyalakan "Kerjakan sebagai tim" sebelum mengirim; opt-in, hanya untuk percakapan baru di project.
  await page.getByRole('button', { name: 'Kerjakan sebagai tim' }).click();
  await page
    .getByRole('textbox', { name: 'Pesan' })
    .fill(`${SCENARIO_TEAM} Tambahkan dua catatan e2e.`);
  await page.getByRole('button', { name: 'Kirim' }).click();

  // Berpindah ke percakapan Lead (navigasi otomatis setelah tim dibuat).
  await expect(page.getByRole('main').getByText('Tambahkan dua catatan e2e.')).toBeVisible({
    timeout: 20_000,
  });

  // Panel Progres: pohon Lead -> tugas -> Worker menggantikan linimasa biasa.
  await page.keyboard.press('Control+.');
  const panel = page.getByRole('region', { name: 'Progres percakapan' });
  await expect(panel.getByText('Lead')).toBeVisible();
  await expect(panel.getByText(TEAM_TASK_1)).toBeVisible({ timeout: 90_000 });

  // omp sungguhan meminta izin menulis file (SECURITY_OPS.md: worker selalu --approval-mode always-ask), satu kali
  // per tugas, muncul di daftar "Izin menunggu" agregat. Izinkan sampai tim selesai, jangan menghitung klik: panel
  // tim memoll tiap 2 detik sehingga tombol izin yang baru diklik masih terlihat sesaat dan klik berikutnya bisa
  // mengenai tombol basi itu, bukan izin tugas kedua (terbukti dari snapshot halaman yang gagal di suite penuh).
  const allow = panel.getByRole('button', { name: 'Izinkan sekali' });
  let allowed = 0;
  await expect
    .poll(
      async () => {
        if ((await panel.getByText('Tim selesai.').count()) > 0) return true;
        if ((await allow.count()) > 0) {
          const clicked = await allow
            .first()
            .click({ timeout: 2_000 })
            .then(() => true)
            .catch(() => false);
          if (clicked) allowed += 1;
        }
        return false;
      },
      { timeout: 180_000, intervals: [500] },
    )
    .toBe(true);
  expect(allowed, 'tiap tugas meminta izin tulis sekurang-kurangnya sekali').toBeGreaterThanOrEqual(
    2,
  );

  // Tugas kedua muncul setelah tugas pertama diterima Lead, dan kedua tugas selesai.
  await expect(panel.getByText(TEAM_TASK_2)).toBeVisible();
  await expect(panel.getByText('Tim selesai.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Hentikan tim' })).toHaveCount(0);

  // Larangan keras: tidak pernah digabung otomatis ke branch kerja pengguna.
  expect(await control.git(repo, 'rev-parse', 'main')).toBe(mainBefore);
  const branches = await control.git(repo, 'branch', '--list', 'aios/*');
  expect(branches.trim().length).toBeGreaterThan(0);
});
