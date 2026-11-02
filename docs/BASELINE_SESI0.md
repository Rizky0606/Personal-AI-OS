# Baseline (Sesi 0)

Kondisi repo sebelum perubahan apa pun dari 14 sesi perombakan. Tidak ada kode sumber, tes, atau konfigurasi yang diubah; hanya berkas ini dan `docs/screenshots/00-baseline/` yang ditambahkan.

## Lingkungan

| Item | Nilai |
| --- | --- |
| Tanggal | 2026-10-29 |
| Commit | `a095614eea0758b2c9108cab3376716cfbd3a895` (`main`, "Merge branch 'feat/48b-pemilih-skill'") |
| Cabang kerja | `chore/sesi-0-baseline` (dari `main`) |
| Node / pnpm / Bun | v24.18.0 / 10.13.1 / 1.4.2 (`engines.node` >=22; CI memakai Node 22) |
| OS | Windows 10.0.26200 x64, AMD Ryzen 7 5700U (16 thread), 15 GB RAM |
| Peramban e2e | Microsoft Edge (`msedge`, default `playwright.config.ts`) |
| Postgres untuk tes gateway | Postgres 16 tertanam (`embedded-postgres`); Docker dan `psql` tidak ada, `TEST_DATABASE_URL` tidak diisi |
| `git status` awal | bersih |

**Catatan penting tentang basis.** Spesifikasi `docs/superpowers/specs/2026-10-29-redesign-command-center-design.md` dan 7 commit perombakan Command Center (`eaa0ac6`, `9503b54`, `31dd08b`, dst.) hanya ada di cabang `feat/54-find-skills-dan-agent-omp`, belum di `main`. Baseline ini diambil dari `main`, jadi screenshot menampilkan UI **lama** (rail 56 px + sidebar 260 px + status bar 24 px, kartu jawaban berbingkai). Lihat "Keputusan yang diperlukan".

## Hasil pemeriksaan

Perintah dijalankan dari root kecuali disebut. `CI` harus kosong untuk tes gateway (lihat kegagalan awal).

| Pemeriksaan | Perintah | Hasil |
| --- | --- | --- |
| Instal | `pnpm install --frozen-lockfile` | lulus, lockfile tidak berubah |
| Build semua paket | `pnpm build` | 7/7 task lulus (contracts, ui-tokens, adapters, roles, gateway, worker, desktop). Peringatan chunk >500 kB di desktop (`main-*.js` 962 kB) |
| Lint | `pnpm lint` (eslint + prettier --check) | lulus, 0 temuan |
| Typecheck | `pnpm exec turbo run typecheck --force` | 12/12 task lulus |
| Tes `@aios/ui-tokens` | `pnpm test` | 20 lulus, 0 gagal, 0 dilewati (1 berkas) |
| Tes kontrak `@aios/contracts` | idem | 95 lulus, 0 gagal, 0 dilewati (2 berkas) |
| Tes `@aios/roles` | idem | 36 lulus, 0 gagal, 0 dilewati (2 berkas) |
| Tes `@aios/adapters` | idem | 52 lulus, 0 gagal, 0 dilewati (3 berkas) |
| Tes `@aios/desktop` (vitest + jsdom) | idem | 513 lulus, 0 gagal, 0 dilewati (65 berkas), 83 dtk |
| Tes `@aios/gateway` (`env -u CI`, Postgres tertanam) | `pnpm test` di `apps/gateway` | 589 lulus, 0 gagal, 13 dilewati (56 berkas), 96 dtk |
| Tes `@aios/worker` (`env -u CI`) | `pnpm test` di `apps/worker` | 254 lulus, 0 gagal, 0 dilewati (18 berkas), 142 dtk |
| Build desktop | `pnpm --filter @aios/desktop build` (bagian `pnpm build`) | lulus (`tsc` + `vite build`, 2474 modul) |
| E2E desktop | `pnpm --filter @aios/e2e e2e` (`env -u CI`) | 13/13 lulus, 2,7 menit (a11y terang+gelap, artifact, lampiran, chat, coding, kanban, keyboard, login, memori, riset, jadwal, ruang). Uji coding berjalan karena `omp` terpasang |
| Android | tidak dijalankan | lihat bagian "Tidak bisa dijalankan" |

Skrip root yang ada: `build`, `dev`, `lint`, `typecheck`, `test`, `format`. Tidak ada skrip `test:contract` terpisah; tes kontrak adalah `@aios/contracts` (di dalam `pnpm test`).

13 tes gateway yang dilewati berasal dari `describe.skipIf` di `modules/research/render.test.ts` (butuh browser, `BROWSER_EXECUTABLE_PATH`) dan `modules/schedules/parser.test.ts` (butuh `PARSE_LIVE_URL`). Pemetaan jumlah per berkas tidak diperiksa satu per satu [INFERENSI].

## Kegagalan awal

Semuanya berasal dari lingkungan atau ketidakstabilan waktu, bukan dari kode. Tidak ada yang diperbaiki.

### 1. Gateway: 36 berkas tes integrasi gagal bila `CI=true`

- Gejala (run pertama, `pnpm exec turbo run test --continue`): `@aios/gateway` 36 berkas gagal, 287 lulus, 315 dilewati (sisa tes di berkas itu tidak jalan). Contoh: `src/security.audit.integration.test.ts`, `src/db/schema.test.ts > migrasi`, `src/modules/auth/auth.integration.test.ts`, dst.
- Pesan: `Error: TEST_DATABASE_URL wajib diisi di CI; tes integrasi tidak boleh dilewati.` (`src/testing/db.ts:15`), disusul `TypeError: Cannot read properties of undefined (reading 'close' | 'drop')` di `afterAll`.
- Penyebab: shell sesi ini punya `CI=true`. `src/testing/global-setup.ts` lalu tidak menyalakan Postgres tertanam dan menyuntikkan URL kosong. Bukan bug kode; ini perilaku sengaja agar CI tidak melewatkan tes integrasi.
- Cara menjalankan benar di mesin tanpa Docker: kosongkan `CI` (`env -u CI pnpm test`) agar Postgres tertanam dipakai, atau isi `TEST_DATABASE_URL=postgres://user:pass@host:5432/postgres` (CI memakai `postgres:16`). Dengan `CI` kosong: 589 lulus, 0 gagal.

### 2. Worker: `src/preview/preview.test.ts` gagal sekali, lalu lulus

- Run pertama (suite penuh bersama paket lain, `CI=true`): 1 gagal, 253 lulus. Tes: `PreviewService: dev server > mendeteksi skrip dev, menjalankannya, dan menyajikan halaman lewat proxy dengan jembatan` (`preview.test.ts:126`).
- Pesan: `expected 'http://127.0.0.1:52251/' to match /^http:\/\/localhost:\d+\/$/` (dev URL yang terdeteksi dari stdout server tiruan berupa `127.0.0.1`, bukan `localhost`).
- Run ulang: berkas itu sendirian 8/8 lulus; suite worker penuh tanpa `CI` 254/254 lulus.
- Dugaan penyebab: ketidakstabilan waktu/beban (run pertama memakan 149 dtk dengan mesin sibuk; stdout server tiruan belum terbaca sehingga URL jatuh ke alamat proxy) [INFERENSI, tidak dibuktikan]. Pantau; bila muncul lagi di CI, selidiki di sesi terpisah.

### 3. Efek samping e2e pada berkas yang dilacak git

Menjalankan e2e menulis ulang `e2e/.stack.json` (berkas terlacak). Berkas dikembalikan dengan `git checkout` setelah run; `git status` bersih kecuali `docs/`.

## Tidak bisa dijalankan

| Item | Alasan | Yang dibutuhkan |
| --- | --- | --- |
| Kompilasi Android (`./gradlew check`, `assembleDebug`) | `java` tidak ada di PATH, `JAVA_HOME` kosong, tidak ada JDK terpasang | **JDK 17** (CI: Temurin 17; `sourceCompatibility`/`jvmTarget` = 17). Gradle wrapper 8.13 (distribusi sudah ada di `~/.gradle/wrapper/dists`), AGP 8.9.1, Kotlin 2.0.21, Compose BOM 2025.05.00, detekt 1.23.8, ktlint plugin 12.2.0, `compileSdk`/`targetSdk` 36, `minSdk` 26 |
| Android SDK | **Ada**: `%LOCALAPPDATA%\Android\Sdk` (platform `android-36`, `android-37.0`, build-tools 35.0.0 dan 36.0.0); `apps/android/local.properties` menunjuk ke sana. `ANDROID_HOME` tidak diatur | Cukup bila `sdk.dir` di `local.properties` tetap benar |
| JDK bawaan Android Studio | Ada di `C:\Program Files\Android\Android Studio\jbr`, tetapi versi 25.0.3. Gradle 8.13 tidak mendukung Java 25 (maks. 24) [INFERENSI dari dokumentasi Gradle, tidak dicoba] | Jangan dipakai; pasang JDK 17 lalu set `JAVA_HOME` |
| Perintah setelah JDK 17 ada | `cd apps/android && ./gradlew ktlintFormat && ./gradlew check && ./gradlew assembleDebug` | Android belum pernah dikompilasi di mesin ini sesuai catatan Fase 11 di `BACKLOG.md`; perbaiki error kompilasi/ktlint yang muncul di sesi Android |
| Build image Docker gateway dan `docker compose` | `docker` tidak terpasang | Docker; diverifikasi CI (job `gateway-image`) |
| Postgres eksternal (`TEST_DATABASE_URL`) | tidak ada; dipakai Postgres tertanam 16.x, produksi `postgres:16` | Docker atau Postgres 16 lokal |
| `infra/scripts/selftest.sh` (langkah CI "check") | tidak dijalankan di sesi ini | `bash` + skrip |
| Build Tauri penuh (`tauri build`, bundel installer) | di luar lingkup sesi; yang dibangun hanya frontend (`vite build`) | toolchain Rust + WiX/NSIS |
| Rendering browser riset (`render.test.ts`), parser jadwal dengan model asli | dilewati otomatis, tanpa `BROWSER_EXECUTABLE_PATH` / `PARSE_LIVE_URL` | browser terpasang; 9Router dengan kredensial |

## Screenshot

`docs/screenshots/00-baseline/` (1280×800, tema gelap, dari build e2e dengan shim Tauri melawan gateway, worker, dan Postgres nyata; Hermes tiruan):

| Berkas | Layar |
| --- | --- |
| `01-login.png` | Login |
| `02-chat-kosong.png` | Chat kosong |
| `03-chat-jawaban.png` | Chat dengan jawaban |
| `04-proyek-workspace.png` | Project (workspace) |
| `05-proyek-kelola.png` | Kelola project |
| `06-kanban.png` | Kanban (2 kartu Backlog) |
| `07-pengaturan.png` | Pengaturan |

Skrip e2e yang ada tidak mengambil screenshot, jadi memakai spec sementara (`e2e/tests/zz-baseline-shots.spec.ts`, memakai fixture `login`/`prepare` yang sama) yang dihapus setelah dipakai dan tidak di-commit. Isi nama sidebar "Judul uji" dan nama project `repo-*` berasal dari data tiruan e2e.

## Keputusan yang diperlukan

1. **Basis perombakan.** `main` belum memuat perombakan Command Center; cabang `feat/54-find-skills-dan-agent-omp` memuatnya (7 commit di depan `main`). Sesi 1 dst. sebaiknya bercabang dari `main` setelah `feat/54` digabung, atau dari `feat/54`. Bila basis tetap `main`, screenshot "sebelum" di sini valid, tetapi spesifikasi perombakan harus ikut dibawa ke `main`.
2. **Temuan di luar lingkup tidak ditulis ke `docs/BACKLOG.md`** karena larangan sesi ("hanya menambah BASELINE.md dan screenshot"). Calon butir: (a) `e2e/.stack.json` terlacak tetapi ditulis ulang tiap run e2e (sebaiknya `.gitignore`); (b) `preview.test.ts` rawan gagal saat beban tinggi; (c) `CI=true` di shell lokal membuat tes gateway gagal tanpa petunjuk bahwa `env -u CI` menyelesaikannya.
