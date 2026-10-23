# apps/android

Aplikasi Android Personal AI OS: Kotlin, Jetpack Compose, Material 3 dengan tema dari token sendiri, Hilt, OkHttp + Retrofit + kotlinx.serialization, Room, DataStore dengan token terenkripsi (Tink + Android Keystore). minSdk 26, target/compile SDK 36.

Proyek Gradle ini berada di luar workspace pnpm. Desain mengikuti `docs/DESIGN_SYSTEM.md`; kontrak API mengikuti `packages/contracts` (model di `data/api/Dto.kt` ditulis tangan dan harus diubah bersama kontrak).

## Prasyarat

- JDK 17 atau lebih baru (JBR bawaan Android Studio cukup; bytecode tetap Java 17) dan Android SDK dengan platform 36 + build-tools. Android Studio memasang keduanya.
- `local.properties` berisi `sdk.dir=...` (dibuat Android Studio; tidak di-commit).

## Perintah

```bash
./gradlew ktlintFormat        # sekali di awal: merapikan urutan import dan gaya
./gradlew check               # ktlint, detekt, lint Android, tes unit
./gradlew assembleDebug       # APK debug (menyertakan katalog komponen)
./gradlew testDebugUnitTest   # hanya tes unit
```

## Token desain

`../../packages/ui-tokens/Tokens.kt` dibangkitkan dari `tokens.json` (`pnpm --filter @aios/ui-tokens build`) dan disalin ke `app/build/generated/aios/tokens` oleh task `syncUiTokens`. Jangan menyalin atau mengedit file itu di sini. Warna latar window (`res/values*/colors.xml`) harus sama dengan `bg`; `ApiModelsTest` menjaganya.

## Struktur

| Folder | Isi |
| --- | --- |
| `data/api` | DTO, antarmuka Retrofit, interceptor (alamat server, token, refresh), pemetaan error |
| `data/auth` | `TokenStore` terenkripsi, `TokenRefresher` (satu refresh untuk semua request), `AuthRepository` |
| `ui/theme`, `ui/components` | Tema dari token, komponen dasar, `StateHost` (memuat, kosong, error, offline) |
| `data/realtime` | WebSocket bersama: backoff, replay `lastSeq`, dedupe seq (`RealtimeClient`) |
| `data/chat`, `data/db` | Repositori chat + cache Room |
| `data/research`, `ui/research` | Daftar, form, progres live, laporan bersitasi, ekspor/bagikan |
| `ui/chat` | Drawer percakapan, layar chat, composer, Markdown (`ui/chat/markdown`) |
| `ui/login`, `ui/main`, `ui/settings` | Layar |
| `src/debug` | Katalog komponen (hanya build debug), HTTP ke `10.0.2.2`/`localhost` |

## Mencoba login ke server

1. Jalankan gateway dan buat pemilik: lihat `apps/gateway` (QR TOTP dipindai di aplikasi autentikator).
2. Debug: jalankan `adb reverse tcp:3000 tcp:3000` lalu isi alamat `http://localhost:3000` (gateway mendengarkan di 127.0.0.1; `http://10.0.2.2:3000` hanya jalan bila gateway dibuka ke 0.0.0.0). Perangkat nyata tanpa adb atau build release: wajib `https://`.
3. Isi alamat, password, dan kode TOTP 6 digit, lalu **Masuk**.

## Push FCM (opsional)

Tanpa konfigurasi ini aplikasi tetap jalan; hanya notifikasi yang tidak ada.

1. Di Firebase Console buat proyek, tambahkan aplikasi Android dengan package `app.aios.android`, lalu unduh `google-services.json` ke `apps/android/app/` (berkas ini rahasia proyek dan di-ignore git).
2. Untuk server: buat service account (Project settings → Service accounts → Generate new private key), simpan di `secrets/` VPS, dan isi `FCM_SERVICE_ACCOUNT_FILE` di gateway (lihat `infra/compose/docker-compose.yml`).
3. Build ulang aplikasi, login, dan izinkan notifikasi saat diminta. Uji dari server: `pnpm --filter gateway push:test`.

Kanal notifikasi: `riset`, `jadwal`, `umum` (ID sama dengan `apps/gateway/src/modules/push/fcm.ts`). Ketukan notifikasi membuka riset, atau percakapan hasil jadwal.
