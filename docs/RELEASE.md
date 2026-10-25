# Rilis dan pengemasan

Panduan membuat rilis 1.0.0 dan seterusnya. Tidak ada rahasia di repo: semua kunci hidup sebagai secret GitHub Actions atau berkas lokal yang di-ignore git.

## 1. Sekali saja: kunci dan secret

| Secret GitHub Actions | Isi | Cara membuat |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Kunci privat penanda tangan updater | `pnpm --filter @aios/desktop tauri signer generate -w ~/.tauri/aios.key` (simpan berkasnya di luar repo) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Kata sandi kunci di atas | dipilih saat `signer generate` |
| `TAURI_UPDATER_PUBKEY` | Isi berkas `aios.key.pub` | hasil `signer generate` |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Keystore rilis Android | `keytool -genkeypair ...`; `base64 -w0 release.jks` |
| `GOOGLE_SERVICES_JSON_BASE64` | `google-services.json` Firebase (push) | dari konsol Firebase |

Kunci privat updater yang hilang berarti semua klien terpasang tidak bisa menerima pembaruan lagi (harus pasang ulang manual). Cadangkan di tempat terpisah dari repo.

Kunci bisa dibuat sekali di PC pengembang ke `secrets/release/` (di-ignore git): keystore Android (`aios-release.jks`), kunci updater Tauri (`tauri-updater.key` dan `.pub`), dan `GITHUB-SECRETS.txt` berisi nilai ketujuh secret di atas (kecuali Firebase) untuk ditempel ke GitHub. Simpan folder itu di password manager atau drive terenkripsi.

## 2. Windows: installer dan auto-update

- `.github/workflows/build.yml` (job `desktop`): di setiap push ke `main` menyuntikkan kunci publik dan versi lewat `tauri.release.conf.json` (tidak di-commit), membangun installer NSIS berisi sidecar worker, menandatanganinya, dan menyusun `latest.json`. Job `rilis` menerbitkannya (bukan draf) setelah build Android juga lulus. Build PR tidak membawa updater dan tidak dirilis.
- `tauri.conf.json` berisi placeholder `GANTI-DENGAN-KUNCI-PUBLIK-UPDATER`; build lokal tanpa overlay tidak bisa memeriksa pembaruan (hanya menampilkan galat), dan itu disengaja.
- Pengaturan, bagian Pembaruan aplikasi: tombol Periksa pembaruan, lalu Pasang dan mulai ulang.
- **Repo publik (saat ini):** updater mengunduh `latest.json` dan installer dari `releases/latest` tanpa kredensial. Bila repo dijadikan privat, klien tidak bisa lagi membacanya: terbitkan artefak rilis ke repo publik terpisah atau host sendiri, lalu ganti `endpoints` di overlay.
- omp tidak dibundel di installer. omp dipasang terpisah dan ditemukan lewat PATH atau `AIOS_OMP_PATH`; versi terkunci di `infra/VERSIONS.md`.

## 3. Android

- `build.yml` (job `android`, paralel dengan `desktop`) membangun APK debug dan, bila secret keystore ada, APK release bertanda tangan. Pasang **APK release**: kuncinya tetap, jadi terpasang menimpa versi sebelumnya. APK debug ditandatangani kunci acak per runner CI dan tidak bisa menimpa APK dari build lain (harus uninstall).
- `versionName` = versi rilis (PR: `<versi terakhir>-pr.<nomor>`); `versionCode` = mayor × 1.000.000 + minor × 1.000 + patch, jadi selalu naik mengikuti versi.

## 4. Gateway di VPS

```bash
infra/scripts/deploy.sh --ref v1.0.0     # backup, build arm64, migrasi, restart, cek /v1/readyz, rollback bila gagal
infra/scripts/deploy.sh --dry-run        # lihat langkah tanpa menjalankan
```

Rollback hanya mengembalikan image. Migrasi database tidak punya langkah mundur, jadi migrasi harus aditif; untuk kerusakan data pakai `infra/scripts/restore.sh` (uji restore dulu).

## 5. Menjalankan E2E

```bash
pnpm --filter @aios/e2e e2e        # desktop (Playwright, Edge atau Chrome; E2E_BROWSER=chrome)
pnpm --filter @aios/e2e android    # Android: butuh emulator/perangkat (adb devices) dan JAVA_HOME JDK 17+
```

## 6. Urutan rilis

Rilis berjalan otomatis (`.github/workflows/build.yml`):

1. **Setiap push ke `main`** (termasuk PR yang di-merge), kecuali push yang hanya mengubah `*.md` atau `docs/`: job `versi` menghitung versi berikutnya (patch +1 dari tag `vX.Y.Z` terakhir), job `desktop` dan `android` berjalan **paralel**, lalu job `rilis` membuat tag dan menerbitkan rilis berisi installer, `.sig`, `latest.json`, dan APK. Aplikasi Windows melihatnya lewat Pengaturan, Pembaruan aplikasi. Bila salah satu build gagal, tidak ada tag atau rilis, dan nomor versi dipakai lagi oleh push berikutnya.
2. **Pull request**: `desktop` dan `android` dibangun paralel sebagai artefak uji (versi `<terakhir>-pr.<nomor>`), tanpa rilis.
3. Rilis berurutan: push yang berdekatan mengantre (concurrency `rilis-main`) supaya tidak berebut nomor versi.
4. **Lompatan minor/mayor**: `node infra/scripts/release.mjs X.Y.Z --push` di `main` yang bersih (menaikkan versi di `tauri.conf.json`, `Cargo.toml`, `build.gradle.kts`, CHANGELOG, lalu push commit dan tag secara atomik). `build.yml` memakai tag itu untuk commit tersebut, dan versi otomatis berikutnya melanjutkan dari sana. `--dry-run` untuk melihat dulu.
5. Gateway tidak ikut dirilis otomatis: `infra/scripts/deploy.sh --ref vX.Y.Z` di VPS bila ada perubahan server.

Semua secret di bagian 1 wajib ada; tanpa secret Tauri, job `desktop` di `main` gagal dengan pesan jelas dan tidak ada rilis.

Aplikasi Windows yang dipasang dari build `main` (bukan tag) tidak membawa kunci publik updater: pasang installer rilis sekali secara manual, setelah itu pembaruan berikutnya lewat Pengaturan, Pembaruan aplikasi.
