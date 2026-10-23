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

## Run coding (Fase 18)

`run.start` dari gateway dijalankan oleh `RunCoordinator`: `git worktree add` ke `aios/<id>` (di luar repo kerja), omp lewat adapter di `packages/adapters` (`--approval-mode always-ask`, role lewat berkas di luar worktree), LLM lewat proxy lokal, dan event dikirim ke gateway (ditahan selama koneksi putus). Izin yang diminta omp ditanyakan ke pengguna kecuali ada aturan "selalu" untuk perintah persis itu di project tersebut. Hasil ditinjau lewat `review.apply`: diterima = commit di branch `aios/...`, ditolak = worktree dan branch dihapus; run tanpa perubahan dibuang sendiri.

- omp dicari sebagai `omp.exe` di PATH, atau lokasi di `AIOS_OMP_PATH`.
- `pnpm --filter @aios/worker test` menjalankan juga uji end-to-end dengan omp sungguhan bila terpasang (dilewati bila tidak).

## Belum ada

- Diff dan checkpoint (Fase 19), pembersihan worktree sisa setelah crash, dan SQLite.
- Penyimpanan SQLite (ARCHITECTURE.md menyebut SQLite milik worker); saat ini cukup dua berkas JSON.
