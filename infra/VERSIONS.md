# Versi tools

Dikunci sesuai `docs/SECURITY_OPS.md` (Pembaruan). Sumber: `docs/VERIFICATION.md` (Fase 0, 2026-10-22).
Upgrade satu komponen per waktu: baca changelog, jalankan tes adapter, baru naikkan versi di sini.

| Tool         | Versi terkunci  | Lokasi              | Status                                                                                                   |
| ------------ | --------------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| omp          | 18.12.6         | PC Windows          | Terverifikasi (RPC diuji langsung)                                                                       |
| 9Router      | 0.5.59          | Diuji di PC Windows | VPS belum dicek. Rilis npm terbaru 0.5.104. Jalankan dengan `--skip-update` dan `-H 127.0.0.1`           |
| Hermes Agent | belum diketahui | VPS                 | Tidak terverifikasi. Rilis terbaru di GitHub v0.22.4 (2026-10-21). Isi setelah `hermes --version` di VPS |
| SearXNG      | belum dikunci   | VPS (Docker)        | Kunci ke tag versi saat setup (lihat `docs/VPS_SETUP.md`)                                                |
| PostgreSQL   | 16              | VPS (Docker)        | Sesuai `docs/ARCHITECTURE.md`                                                                            |

## Toolchain repo

| Tool                                             | Versi                      |
| ------------------------------------------------ | -------------------------- |
| Node.js                                          | >= 22 (CI memakai 22)      |
| pnpm                                             | 10.13.1 (`packageManager`) |
| TypeScript                                       | ~5.9.3                     |
| Turborepo                                        | ^2.11.10                   |
| Fastify                                          | ^5.12.7                    |
| Drizzle ORM / drizzle-kit                        | ^0.45.4 / ^0.31.11         |
| pg (node-postgres)                               | ^8.23.1                    |
| tsx (dev server)                                 | ^4.23.15                   |
| embedded-postgres (hanya tes)                    | 16.14.0-beta.17            |
| Zod                                              | ^4.6.7                     |
| @asteasolutions/zod-to-openapi (hanya generator) | ^9.1.0                     |
| Vitest                                           | ^5.0.5                     |
| @node-rs/argon2 (argon2id)                       | ^2.2.2                     |
| jose (JWT HS256)                                 | ^6.2.13                    |
| @fastify/rate-limit                              | ^11.2.1                    |
| qrcode (QR TOTP di terminal)                     | ^1.5.4                     |
| @fastify/websocket (WebSocket `/v1/ws`)          | ^11.3.4                    |
| ws + @types/ws (klien WebSocket, hanya tes)      | ^8.22.0 / ^8.18.2          |
| yaml (parser frontmatter role dan skill)         | ^2.9.1                     |
| pg-boss (antrean job riset dan jadwal)           | ^12.38.0                   |
| cron-parser (waktu jalan berikutnya, penjelasan) | ^5.10.2                    |
| @mozilla/readability + jsdom (ekstraksi teks)    | ^0.6.0 / ^30.1.3           |
| pdfkit (ekspor PDF)                              | ^0.20.2                    |
| playwright-core (render halaman JavaScript)      | ^1.64.1                    |

## Android (`apps/android`, Gradle; belum pernah di-build di mesin pengembangan)

| Komponen                                                   | Versi                    |
| ---------------------------------------------------------- | ------------------------ |
| Gradle (wrapper)                                           | 8.13                     |
| Android Gradle Plugin                                      | 8.9.1                    |
| Kotlin / KSP (disamakan dengan detekt)                     | 2.0.21 / 2.0.21-1.0.28   |
| compileSdk / targetSdk / minSdk                            | 36 / 36 / 26             |
| Compose BOM (Material 3 dari BOM)                          | 2025.05.00               |
| Navigation Compose / Activity Compose                      | 2.9.0 / 1.10.1           |
| Hilt / hilt-navigation-compose                             | 2.56 / 1.2.0             |
| OkHttp / Retrofit (+ converter kotlinx)                    | 4.12.0 / 2.11.0          |
| kotlinx.serialization / coroutines                         | 1.8.1 / 1.10.2           |
| Room / DataStore                                           | 2.7.1 / 1.1.7            |
| Tink (enkripsi token, kunci di Keystore)                   | 1.17.0                   |
| ktlint (plugin) / detekt                                   | 12.2.0 / 1.23.8          |
| IBM Plex Sans/Mono (font dibundel, OFL)                    | dari github.com/IBM/plex |
| Firebase BOM (firebase-messaging) / google-services plugin | 33.7.0 / 4.4.2           |

## Desktop (`apps/desktop`)

| Komponen                                                   | Versi                                |
| ---------------------------------------------------------- | ------------------------------------ |
| React / React DOM                                          | ^19.3.1                              |
| Vite / @vitejs/plugin-react                                | ^8.3.5 / ^6.1.2                      |
| Tailwind CSS (+ @tailwindcss/vite)                         | ^4.3.3                               |
| TanStack Router / Query                                    | ^1.170.46 / ^5.104.5                 |
| Radix UI (dialog, tabs, toast, tooltip)                    | ^1.3.1 / ^1.2.1 / ^1.3.1 / ^1.4.1    |
| Radix UI dropdown-menu                                     | ^2.2.1                               |
| @tauri-apps/plugin-opener / tauri-plugin-opener (crate)    | ^2.7.2 / 2                           |
| Zustand / lucide-react                                     | ^5.0.16 / ^1.61.0                    |
| @tauri-apps/api, plugin-http, plugin-websocket, cli        | ^2.12.4 / ^2.8.3 / ^2.5.0 / ^2.12.4  |
| Tauri (crate) / tauri-plugin-http / tauri-plugin-websocket | 2 / 2 / 2 (belum dikunci Cargo.lock) |
| keyring (crate, backend windows-native)                    | 3                                    |
| @testing-library/react / user-event / jest-dom, jsdom      | ^16.3.3 / ^14.6.8 / ^7.0.1, ^30.1.3  |
