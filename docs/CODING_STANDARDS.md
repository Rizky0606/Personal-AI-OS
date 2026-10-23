# Coding Standards — Personal AI OS

Satu bahasa utama (TypeScript strict) untuk gateway, desktop, worker, dan paket bersama. Kotlin hanya untuk Android, Rust hanya untuk shell Tauri yang tipis.

## Tooling

| Hal | Pilihan |
| --- | --- |
| Package manager | pnpm workspace + Turborepo |
| Bahasa | TypeScript 5.x `strict`, `noUncheckedIndexedAccess`, ES modules |
| Lint dan format | ESLint flat config + Prettier (atau Biome, pilih satu di Fase 1) |
| Validasi | Zod di setiap batas: request, response, event, env, output model |
| Tes | Vitest (unit dan integrasi), Playwright (E2E desktop), JUnit + Compose UI test (Android) |
| DB | Drizzle ORM + drizzle-kit migration, satu folder migrasi |
| Log | pino, format JSON, dengan `runId` dan `requestId` |
| Kotlin | ktlint, detekt |
| Rust | rustfmt, clippy `-D warnings` |

## TypeScript

- Tanpa `any`. Gunakan `unknown` lalu persempit dengan Zod.
- Tipe dari skema (`z.infer`), bukan ditulis dua kali.
- Fungsi kecil dengan satu tanggung jawab. File di atas sekitar 300 baris dipecah.
- Error domain memakai kelas atau union bertipe dengan `code`, bukan string bebas.
- Async selalu ditangani: tanpa promise mengambang, timeout untuk setiap panggilan jaringan.
- Nama: `camelCase` variabel dan fungsi, `PascalCase` tipe dan komponen, `kebab-case` nama file, `SCREAMING_SNAKE` env.

## Gateway

- Struktur per modul: `modules/<area>/{routes,service,repo,schema}.ts`.
- Route tipis: validasi, panggil service, kembalikan hasil. Logika di service. Akses DB hanya di repo.
- Setiap endpoint punya tes integrasi dengan Postgres nyata (Testcontainers atau database tes).
- Konfigurasi dari env yang divalidasi Zod saat start; gagal cepat jika kurang.

## Desktop (React)

- React 19 + Vite + TanStack Router + TanStack Query. State UI lokal memakai Zustand bila perlu.
- Komponen primitif dari Radix (atau Base UI), gaya dari token Tailwind v4. Tanpa library komponen bergaya bawaan.
- Satu komponen per file, props bertipe, tanpa logika data di komponen presentasi.
- Ikon Lucide. Font IBM Plex dibundel lokal, tanpa CDN.

## Worker

- Setiap proses anak (omp, dev server, terminal) dilacak dan dimatikan saat run berhenti atau aplikasi keluar.
- Semua path dinormalisasi dan dicek berada di dalam folder yang diizinkan sebelum dipakai.
- Perintah shell tidak pernah dibangun dari string gabungan; argumen dikirim sebagai array.

## Android

- Kotlin, Jetpack Compose, Material 3 dengan tema dari token sendiri.
- Arsitektur: UI (Compose) → ViewModel (StateFlow) → Repository → API (OkHttp/Retrofit) dan Room.
- Dependency injection dengan Hilt. Coroutine dengan scope yang jelas.
- Token disimpan di EncryptedSharedPreferences atau DataStore terenkripsi.

## Testing minimum per fitur

- Unit untuk logika murni (router rules, parser jadwal, normalisasi event).
- Integrasi untuk setiap endpoint dan adapter (adapter dengan mock server atau proses palsu).
- E2E untuk alur P0: login, chat streaming, run coding sampai review, riset sampai laporan.
- Snapshot contract: perubahan skema di `packages/contracts` harus memperbarui tes kontrak.

## Git dan review

- Conventional Commits, branch per fase.
- CI (GitHub Actions): lint, typecheck, tes, build untuk setiap push.
- Tag rilis `vX.Y.Z`; changelog dibuat dari commit.
