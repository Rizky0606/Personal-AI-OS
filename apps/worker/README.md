# apps/worker

Worker sidecar Windows: proses lokal yang menyentuh folder project dan (mulai Fase 18) menjalankan agent. TypeScript, dikompilasi **Bun** menjadi satu `.exe` yang dijalankan Tauri sebagai sidecar. Dimulai dan dimatikan bersama aplikasi desktop.

## Perintah

```bash
pnpm --filter @aios/worker test             # Vitest (path, proses, git, koneksi gateway, server lokal)
pnpm --filter @aios/worker build:sidecar    # bun build --compile -> apps/desktop/src-tauri/binaries/aios-worker-x86_64-pc-windows-msvc.exe
pnpm --filter @aios/worker smoke:sidecar    # jalankan .exe hasil build: hello, status.get, berhenti saat stdin ditutup
```

`tauri dev` dan `tauri build` mewajibkan berkas sidecar ada; jalankan `build:sidecar` lebih dulu (butuh [Bun](https://bun.sh)). Berkasnya ±86 MB dan tidak di-commit.

## Cara kerja

```
Aplikasi desktop (webview) ── ws://127.0.0.1:<port acak> ──▶ Worker ── wss://<gateway>/v1/worker/ws ──▶ Gateway
        ▲ token sekali pakai dari Tauri                         token scope worker (didaftarkan otomatis)
```

1. Tauri menjalankan `aios-worker.exe` dengan `AIOS_WORKER_TOKEN` (acak, 256 bit) dan `AIOS_WORKER_DATA_DIR`. Worker mendengarkan di `127.0.0.1` port acak lalu mencetak satu baris `{"event":"listening","port":N}` ke stdout.
2. Desktop mengambil port dan token dari Tauri (`worker_connect_info`), membuka WebSocket lokal, dan mengirim `hello`. Balasan `ready` membawa **token untuk koneksi berikutnya**; token lama tidak berlaku lagi. Bila rantai putus, Tauri memulai ulang worker dengan token baru.
3. Koneksi dengan header `Origin` (halaman web) ditolak, jadi situs lain tidak bisa menyambung ke worker.
4. Setelah login, desktop mendaftarkan perangkat worker (`POST /devices/worker`), menyimpan tokennya di Windows Credential Manager (`app.aios.desktop/worker`), dan memberikannya ke worker (`session.set`). Worker menyambung ke gateway, memperbarui token sendiri, dan mendorong refresh token baru ke desktop (`session.updated`).
5. Saat aplikasi keluar (juga bila crash), pipe stdin worker tertutup dan worker berhenti sendiri setelah mematikan semua proses anaknya.

Protokol lokal: `packages/contracts/src/worker-local.ts`. Protokol ke gateway: `packages/contracts/src/worker.ts`.

## Keamanan

- **Folder yang diizinkan** (`allowed-folders.json` di folder data): semua path dinormalisasi dan diselesaikan (`realpath`) sebelum dibandingkan, jadi `..`, symlink, dan junction yang menunjuk keluar ditolak. Path UNC, namespace/perangkat Windows (`\\?\`, `\\.\`), path relatif, dan byte NUL ditolak. Root drive dan folder home (beserta leluhurnya) tidak bisa diizinkan. Akar yang belakangan diganti junction ke tempat lain kehilangan izinnya.
- **Proses anak** (`ProcessManager`): tanpa shell (perintah dan argumen terpisah), `cwd` wajib di dalam folder izin, batas jumlah bersamaan (8), batas waktu, keluaran dipotong (1 MB), dimatikan beserta turunannya (`taskkill /T`) saat run selesai atau worker berhenti.
- Path project hanya disimpan di worker (`projects.json`); gateway hanya menerima nama, stack, dan branch bawaan.
- Log ke stderr tanpa token atau isi folder.

## Belum ada

- Adapter omp, worktree, approval, dan eksekusi run coding (Fase 18). Perintah `run.start` dari gateway dijawab `error worker_not_ready` lalu `run.status failed` supaya run tidak menggantung.
- Penyimpanan SQLite (ARCHITECTURE.md menyebut SQLite milik worker); saat ini cukup dua berkas JSON.
