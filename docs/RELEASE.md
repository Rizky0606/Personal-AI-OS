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

## 2. Windows: installer dan auto-update

- Tag `v*` memicu `.github/workflows/build-desktop.yml`: menyuntikkan kunci publik dan versi lewat `tauri.release.conf.json` (tidak di-commit), membangun installer NSIS berisi sidecar worker, menandatanganinya, menyusun `latest.json`, dan membuat rilis **draf**.
- `tauri.conf.json` berisi placeholder `GANTI-DENGAN-KUNCI-PUBLIK-UPDATER`; build lokal tanpa overlay tidak bisa memeriksa pembaruan (hanya menampilkan galat), dan itu disengaja.
- Pengaturan, bagian Pembaruan aplikasi: tombol Periksa pembaruan, lalu Pasang dan mulai ulang.
- **Repo privat:** updater mengunduh `latest.json` dan installer tanpa kredensial, jadi rilis di repo privat tidak bisa dibaca klien. Pilihan: (a) terbitkan hanya artefak rilis (installer bertanda tangan, tanpa kode atau rahasia) ke repo publik terpisah dan ganti `endpoints` di overlay; atau (b) host `latest.json` dan installer di server sendiri. Belum diputuskan; lihat `docs/BACKLOG.md`.
- omp tidak dibundel di installer. omp dipasang terpisah dan ditemukan lewat PATH atau `AIOS_OMP_PATH`; versi terkunci di `infra/VERSIONS.md`.

## 3. Android

- `build-android.yml` membangun APK debug di setiap push dan `assembleRelease` bertanda tangan bila secret keystore ada. Pasang APK lewat `adb install` atau unduh artefak.

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

1. Semua centang `docs/ACCEPTANCE.md` yang bisa diverifikasi sudah dicentang, sisanya tertulis alasannya.
2. Versi 1.0.0 sudah diset di `tauri.conf.json`, `Cargo.toml`, dan `build.gradle.kts` (naikkan `versionCode` Android setiap rilis); pindahkan isi CHANGELOG dari "belum dirilis" ke tanggal rilis.
3. `git tag v1.0.0 && git push --tags`; periksa rilis draf, pasang installer di PC bersih, lalu terbitkan.
4. `infra/scripts/deploy.sh --ref v1.0.0` di VPS.
