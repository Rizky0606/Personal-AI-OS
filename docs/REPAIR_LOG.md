# Repair Log

Catatan sesi perbaikan P0 sampai P8: tanggal, sesi, hash, ringkasan, bukti.

## P0 — Satukan cabang dan alat bukti visual (2026-11-02)

Cabang kerja: `fix/p0-satukan-cabang` (dari `main` = `23d785b`, sama dengan `origin/main` setelah `git fetch --all --prune`).

### A. Inventaris cabang

Total 55 cabang lokal dan 49 cabang remote (selain `main`). Semua cabang berbasis di jalur `main` (riwayat berantai lurus, tanpa merge commit selain PR #10 sampai #13 Sesi 4).

**Belum tergabung ke `main` (3 cabang):**

| Cabang | Sesi / isi | Basis | Commit di luar main | Keputusan |
| --- | --- | --- | --- | --- |
| `chore/sesi-0-baseline` (lokal saja) | Sesi 0: `BASELINE.md`, 7 screenshot `00-baseline`, temuan Sesi 0 di BACKLOG | `a095614` | 2 (`5ac7668`, `872c2cc`) | **Digabung** (lihat konflik di bawah) |
| `feat/sesi-4-shell-desktop` (lokal = remote) | Sesi 4, commit terakhir `b137437` | `eeff719` | 1 | **Tidak digabung**: digantikan `main` (lihat di bawah) |
| `fix/gradlew-exec` (lokal = remote) | bit eksekusi `gradlew` + tes kanban | `39cbebd` | 2 (`dd0ac1f`, `454dbd8`) | **Tidak digabung**: sudah ada di `main` dengan bentuk lain |

Rincian cabang tidak digabung:

- `b137437` (Sesi 4): (a) menghapus `runner` dari `AppDeps` dan `workerArtifactRoutes`, termasuk guard `run_not_active` (`runner.isActive`) pada unggah screenshot worker; (b) menambah `uploadWorkerScreenshot` di `contracts/endpoints/work.ts`; (c) menyesuaikan `MarkdownTest.kt` dan `security.audit.integration.test.ts`. `main` sudah menyelesaikan hal yang sama lewat `038f613`: endpoint ada di `contracts/endpoints/misc.ts` (menggabung `b137437` akan menggandakan kontrak), guard `runner.isActive` dipertahankan (menggabung akan melemahkan pemeriksaan), dan tes Android `main` lebih baru (`ChatModelsTest`). Tidak ada fitur dari commit ini yang hilang di `main`.
- `fix/gradlew-exec`: `apps/android/gradlew` sudah mode `100755` di `main` (blob identik); perbaikan balapan tes kanban sudah ada di `main` (`tasks.idle()` di baris 403, urutan B lalu C) lewat `417e4cd` dan `f475524`.

**Sudah tergabung (`merged=Y`, 0 commit di luar main):** semua cabang lain, termasuk `feat/16` sampai `feat/54-find-skills-dan-agent-omp` (perombakan Command Center, tip `31dd08b`), `feat/sesi-1-design-system` (`20ddaf0`), `feat/sesi-2-event-adapter` (`e5471fe`), `feat/sesi-3-data-aktivitas` (`d3342e8`), dan semua `fix/*`, `chore/*`, `ci/*`, `docs/*`. Cabang remote kembar lokal-nya dengan status sama. Tidak ada cabang Sesi 5 sampai 13 yang terpisah: pekerjaan Sesi 5 sampai 8 (`7ed2bd6`, `8078b6a`, `ff94e35`, `c5477b6`) dikerjakan langsung di jalur `main`. `origin/fix/vps-backup-restic-and-version-checks` hanya ada di remote (tergabung).

### Kerugian penggabungan lama

Penelusuran: berkas yang ada di ujung tiap cabang sesi tetapi hilang di `main`, dan riwayat `Shell.tsx`.

| Temuan | Penyebab | Status |
| --- | --- | --- |
| `Shell.tsx` tidak memakai `Topbar` dan `island` | `e23deff` ("shell pulau") memasang `Topbar`+`island`. `fc5a84b` (Sesi 4) menulis ulang `Shell.tsx` tanpa keduanya; `b5f79ad` hanya menambah 2 baris. `island.ts` kini hanya dipakai `RightPanel.tsx` dan `ShellSkeleton.tsx`; `Topbar.tsx` tidak dipakai berkas produksi mana pun | **Dipulihkan di P1** (dilarang di P0) |
| `docs/BASELINE.md` versi Sesi 0 tertimpa | `ff94e35` (Sesi 7) menulis ulang `BASELINE.md` | Dipulihkan sebagai `docs/BASELINE_SESI0.md` pada merge `chore/sesi-0-baseline` |
| Temuan Sesi 0 di `BACKLOG.md` dan `docs/screenshots/00-baseline/` | Cabang `chore/sesi-0-baseline` tidak pernah digabung | Dipulihkan lewat merge yang sama |
| `Rail.tsx`, `StatusBar.tsx`, `StatusBarInfo.test.tsx` dihapus | Sengaja: digantikan shell pulau (Sesi 4) | Bukan kerugian |
| Font IBM Plex + lisensi Android dihapus | Sengaja: diganti tema Geist (Sesi 7) | Bukan kerugian |
| `richAnswerParser.ts` di akar repo dihapus di `b5f79ad` | Berkas tersasar, bukan kode aplikasi | Bukan kerugian |

Berkas desktop yang disentuh Sesi 4 (`git diff --name-only 31dd08b eeff719 -- apps/desktop`) identik antara `main` dan ujung cabang Sesi 4 (`eeff719`). Berkas yang disentuh `e23deff` dan berbeda di `main` (mis. `Sidebar.tsx`, `styles.css`, layar Pengaturan/Kuota/Status) berubah oleh pekerjaan Sesi 4 sampai 6 setelahnya; tidak ada yang hilang kecuali butir di atas.

### B. Konflik penggabungan

| Berkas | Pilihan | Alasan |
| --- | --- | --- |
| `docs/BASELINE.md` (add/add) | Versi `main` dipertahankan; versi Sesi 0 disimpan sebagai `docs/BASELINE_SESI0.md` | Kedua dokumen berisi informasi berbeda; keduanya dipertahankan |
| `docs/BACKLOG.md` | Versi `main` + bagian "Temuan Sesi 0" disisipkan sebelum "Temuan Sesi 1"; rujukan diarahkan ke `BASELINE_SESI0.md` | Cabang lama hanya menambah satu bagian; sisanya basi |

### C. Alat bukti visual

- **Cap build.** `e2e/vite.e2e.config.ts` menanam `__BUILD_COMMIT__` (`git rev-parse --short HEAD`), `__BUILD_TIME__`, dan `__BUILD_DIRTY__` (ada perubahan belum di-commit, tanpa menghitung `docs/screenshots`, `e2e/.stack.json`, `e2e/test-results`). `apps/desktop/src/buildStamp.ts` (dipanggil dari `main.tsx`) memasang atribut `data-build-commit` dan `data-build-dirty` di `#root` serta label kecil kanan-bawah (`hash[*] waktu`). Di build rilis konstanta tidak ada, jadi tidak ada atribut dan label (dibuktikan tes `buildStamp.test.ts`).
- **`pnpm shots <kode-sesi>`** (`e2e/harness/shots.ts`): membangun ulang app e2e, menyalakan `startStack`, login lewat UI, memotret 14 layar x 2 tema (gelap, terang) 1440x900 ke `docs/screenshots/<kode>/<tema>-<layar>.png`: login, chat-kosong, chat-berjalan (500 ms setelah kirim), chat-selesai, panel-kanan, lebar-1024, palet, project, kanban, jadwal, riset, ruang, pengaturan-atas, pengaturan-gulir (area isi di `<main>`, bukan sidebar). Memakai `prefers-reduced-motion: reduce` agar hasil stabil. Sebelum memotret membandingkan `data-build-commit` dengan `git rev-parse --short HEAD`; beda = gagal "build basi". `SHOTS_SKIP_BUILD=1` hanya untuk menguji penjaga itu.
- **`pnpm shots:compare <A> <B>`** (`e2e/harness/shots-compare.ts`, fungsi di halaman: `in-page.js`): persentase piksel berbeda (beda > 24 pada kanal mana pun) lewat canvas `getImageData` di Playwright, tanpa pustaka gambar baru. Persegi 280x32 px kanan-bawah (label cap) tidak dihitung. Keluaran tabel markdown dan gambar `A | B | selisih` di `docs/screenshots/_compare/<A>__<B>/` (diabaikan git). Path relatif dihitung dari folder tempat perintah diketik (`INIT_CWD`).
- **Baseline.** `docs/screenshots/baseline-p0/` (28 gambar) diambil dari commit `a67ef46`, working tree bersih, semua gambar bercap `a67ef46`.

Bukti:

- Penjaga basi: setelah commit baru, `SHOTS_SKIP_BUILD=1 pnpm shots tmp-basi` gagal dengan `build basi: halaman a67ef46 != HEAD f19c62b. Bangun ulang app e2e.` dan tidak menghasilkan gambar.
- Kestabilan: `shots p0-ulang` (commit `f19c62b`) vs `baseline-p0`: 0,00% sampai 0,13% per layar, kecuali `terang-ruang` 0,62% (jam dan data dinamis). Itulah batas derau untuk membaca perbandingan sesi berikutnya.

### D. Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| `pnpm typecheck` | lulus (exit 0) |
| `pnpm lint` (eslint + prettier) | lulus (exit 0) |
| test ui-tokens / contracts / roles / adapters | 28 / 138 / 36 / 102 lulus (+2 dilewati sejak awal) |
| test desktop | 87 file, 780 tes lulus (termasuk 3 tes `buildStamp`) |
| test gateway (Postgres tertanam) | 611 lulus, 13 dilewati sejak awal, **2 gagal**: `dsh.integration` "izin diminta..." dan "izin ditolak..." (flaky, lihat BACKLOG "Temuan P0"); gateway tidak berbeda dari `main`; gagal 1 dari 3 run terisolasi |
| e2e desktop (`pnpm --filter @aios/e2e e2e`) | 23 lulus |

### E. Keputusan alur cabang (2026-11-02)

Bagian D prompt P0 diubah atas keputusan pemilik repo: P0 **tidak** digabung ke `main` dan tidak di-push ke `main`. Tiap sesi perbaikan memakai cabang terpisah yang dibuat dari ujung cabang sesi sebelumnya (P0 `fix/p0-satukan-cabang` -> P1 -> ... -> P8), sehingga kodenya tetap tersambung. Merge ke `main`, push, dan penghapusan cabang lama (daftar butuh persetujuan) dilakukan sekali, di sesi terakhir. Konsekuensi: `main` tetap `23d785b` sampai saat itu, jadi baseline `baseline-p0` dan perbandingan `pnpm shots:compare` memakai folder baseline dari cabang P0, bukan dari `main`.
