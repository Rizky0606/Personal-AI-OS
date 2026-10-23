# apps/desktop

Aplikasi Windows Personal AI OS: Tauri 2 (cangkang Rust yang tipis) + React 19 + Vite + TypeScript + Tailwind CSS v4 + TanStack Router/Query + Radix + Zustand. Desain mengikuti `docs/DESIGN_SYSTEM.md`; token dari `@aios/ui-tokens`; skema API dari `@aios/contracts`.

## Prasyarat (Windows)

- Node 22+ dan pnpm (sudah untuk monorepo).
- **Rust** (stable, target `x86_64-pc-windows-msvc`) dan **Microsoft C++ Build Tools** (Visual Studio Build Tools, beban kerja "Desktop development with C++"). Tanpa ini `cargo` gagal di tahap link.
- **WebView2** (sudah ada di Windows 11).

## Perintah

```bash
pnpm --filter @aios/desktop dev            # hanya UI di peramban (http://127.0.0.1:1420); WebSocket dan Credential Manager tidak ada
pnpm --filter @aios/desktop tauri dev      # aplikasi Tauri penuh dengan hot reload
pnpm --filter @aios/desktop tauri build    # installer NSIS di src-tauri/target/release/bundle
pnpm --filter @aios/desktop test           # Vitest (logika dan komponen)
pnpm --filter @aios/desktop typecheck
```

Di mode `dev` biasa (tanpa Tauri) penyimpanan token memakai localStorage dan WebSocket terautentikasi tidak tersedia; itu hanya untuk mengerjakan tampilan. Halaman **Katalog komponen** ada di `#/dev/catalog` (hanya mode dev).

## Struktur

| Folder          | Isi                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------- |
| `src/auth`      | Sesi (`AuthSession`: login, refresh satu-pintu), vault token, normalisasi alamat server  |
| `src/realtime`  | `RealtimeClient` (backoff, replay `lastSeq`, heartbeat), deteksi bangun dari tidur       |
| `src/shell`     | Rail 56px, sidebar 260px, panel kanan bertab (lebar bisa diubah), status bar 24px, palet |
| `src/ui`        | Komponen dasar (satu per berkas) dan `StateView` (memuat, kosong, error, offline, isi)   |
| `src/screens`   | Login, Pengaturan, katalog, layar placeholder                                            |
| `src-tauri`     | Rust tipis: `secret_get/set/remove` (Windows Credential Manager), `device_name`, plugin  |

## Keamanan

- Token (access dan refresh) disimpan sebagai satu entri di **Windows Credential Manager** (`app.aios.desktop/session`), tidak pernah di localStorage atau berkas. Batas satu entri 2560 byte; `SessionVault` menolak menyimpan bila lebih besar.
- HTTP dan WebSocket ke gateway lewat plugin Tauri (klien Rust): CORS gateway tetap tertutup, dan header Authorization bisa dipasang saat handshake WebSocket (webview tidak bisa).
- Refresh token dirotasi server, jadi hanya satu refresh yang berjalan sekaligus (`AuthSession.refresh` memakai satu promise bersama).
- Alamat server wajib `https://` kecuali loopback (`localhost`, `127.0.0.1`).
- CSP di `tauri.conf.json` hanya mengizinkan sumber lokal dan IPC.
