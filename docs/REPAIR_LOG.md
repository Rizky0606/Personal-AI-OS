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

## P1 — Pasang shell baru (2026-11-02)

Cabang: `fix/p1-pasang-shell` (dari ujung `fix/p0-satukan-cabang` = `d224b1f`; tidak digabung ke `main`, lihat bagian E di atas).

Kerugian merge lama yang dipulihkan: `Shell.tsx` kembali memakai `Topbar` dan `island` (hilang sejak `fc5a84b`).

### Perubahan

- `Shell.tsx`: kanvas `[data-shell-canvas]` (`bg`, padding dan gap `--aios-island-gap`); `Sidebar`, `<main>`, dan `RightPanel` memakai `ISLAND`; `Topbar` di dalam `<main>`; `Header.tsx` dihapus (tidak ada pemakai lain; pencarian kosong).
- Aturan judul tunggal: Topbar satu-satunya pemilik h1; `PageHeader` (`screens/PageLayout` dan `ui/PageHeader`) mendaftarkan judul lewat `ScreenTitleContext` (`ui/screenTitle.tsx`) dan tidak merender judul di dalam Shell. Tertulis di `DESIGN_SYSTEM.md`.
- `Sidebar.tsx`: pulau; tombol buka saat ringkas di sidebar; tinggi kepala memakai `--aios-topbar-height` (`--aios-header-height` tidak pernah terdefinisi, sehingga kepala sidebar lama tak bertinggi tetap). Penyebab pelat tidak terlihat meluncur: tautan aktif/hover punya latar sendiri yang langsung berpindah dan menutupi pelat; sekarang tautan di dalam `PlateGroup` tanpa latar (`plated`).
- `RightPanel.tsx`: slot pemotong yang lebarnya dianimasikan (lebar tersimpan + jarak 8 px), `-ml` meniadakan gap flex; pulau di dalamnya berlebar tetap, menempel kanan. Tes e2e menangkap jarak 16 px (bukan 8) sebelum diperbaiki.
- `Topbar.tsx`: grup "Lokasi saat ini" (judul, chip project + branch, penanda Berjalan, chip model). Chip bawaan "Chat umum" dan "Model otomatis" (dulu "Otomatis · Otomatis" dari Header). Role tidak ditampilkan lagi.
- `ShellSkeleton.tsx`: sesuai shell baru (tanpa penyangga bilah status 24 px yang sudah tidak ada).
- Tes: `Shell.test.tsx` (pulau, Topbar di dalam main, urutan fokus, aria-current, judul tunggal), `Topbar.test.tsx` (kasus Header dipindah), `ui/screenTitle.test.tsx`, `ProjectChat.test.tsx` (breadcrumb lewat Topbar), `ShellInfo.test.tsx` (blok Header dihapus, sudah tercakup di Topbar), e2e `shell.spec.ts` (5 tes baru).
- `pnpm shots:compare` menerima argumen ketiga (ambang kanal, bawaan 24).

### Bukti tersambung

```
Topbar:      shell\Shell.tsx:20 import, :151 <Topbar
ISLAND:      Sidebar.tsx:71, Shell.tsx:149, RightPanel.tsx:55, ShellSkeleton.tsx:11
ScreenTitle: Shell.tsx:124 Provider; PageLayout.tsx:22 dan ui\PageHeader.tsx:17 useScreenTitle
PlateGroup:  Sidebar.tsx:141, ProjectList.tsx:53
Header lama: tidak ada pemakai (rg "shell/Header|from './Header'|<Header" kosong)
```

### Bukti visual

Gambar: `docs/screenshots/p1/<tema>-<layar>.png`, bercap `e67dab0` (tanpa tanda kotor). Baseline: `docs/screenshots/baseline-p0/` (cap `a67ef46`).

Persentase piksel berbeda (`pnpm shots:compare baseline-p0 p1`): kolom A ambang kanal 24 (bawaan, ambang selesai), kolom B ambang 4.

| Layar | A (24) gelap | B (4) gelap | A (24) terang | B (4) terang |
| --- | ---: | ---: | ---: | ---: |
| chat-kosong | 6,66% | 72,28% | 6,29% | 71,88% |
| chat-selesai | 6,29% | 75,43% | 6,32% | 75,34% |
| kanban | 4,75% | 83,41% | 4,69% | 84,63% |
| project | 4,44% | 83,50% | 4,20% | 84,55% |
| pengaturan-atas | 8,91% | 75,48% | 8,52% | 76,33% |
| chat-berjalan | 6,37% | 75,53% | 6,40% | 75,43% |
| lebar-1024 | 8,26% | 71,82% | 8,26% | 71,69% |
| panel-kanan | 7,01% | 53,10% | 6,95% | 53,00% |
| jadwal / riset / ruang | 4,05 / 4,59 / 5,27% | 84,01 / 68,66 / 74,75% | 3,81 / 4,42 / 4,75% | 85,10 / 69,61 / 76,07% |
| login / palet | 0,00 / 0,00% | 0,00 / 6,26% | 0,00 / 0,02% | 0,00 / 4,84% |

**Ambang selesai (15% pada ambang 24) TIDAK tercapai** untuk kelima layar di kedua tema (4,2 sampai 8,9%). Penyebab yang diperiksa: build tidak basi (cap `e67dab0`, tanpa tanda kotor; penjaga "build basi" lolos), kelas terpakai (e2e mengukur jarak 8 px dan Topbar di dalam pulau), token terdefinisi (`--aios-island-gap`, `--aios-topbar-height`; `--aios-header-height` tidak pernah terdefinisi dan kini tidak dipakai). Penyebab sebenarnya: `bg` vs `surface-1` hanya berbeda sekitar 8/255 per kanal (gelap) dan 5/255 (terang), jauh di bawah ambang 24, sehingga latar pulau tidak terhitung; pada ambang 4 perubahan 72 sampai 85%. Token tidak diubah (di luar scope). Keputusan ada di laporan.

### Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| typecheck | lulus |
| eslint + prettier | lulus (setelah memperbaiki 2 cast di `shell.spec.ts`) |
| desktop | 88 file, 794 tes lulus |
| ui-tokens / contracts / roles / adapters | 28 / 138 / 36 / 102 lulus |
| gateway | 59 file, 613 lulus, 13 dilewati sejak awal |
| worker | 281 lulus, 1 gagal pada run penuh: `preview.test.ts` "lampiran composer..." (timeout hook `afterEach` Playwright); lulus 8/8 saat dijalankan sendirian; worker tidak berubah dari P0 |
| e2e desktop | 28 lulus (23 lama + 5 baru) |

## P2 — Chat (2026-11-02)

Cabang `fix/p2-chat` (dari ujung P1). Hasil: avatar `AgentOrb` 28 px; baris aktivitas (judul abu berkilau, baris terlipat, linimasa) di dalam jawaban, bilah lama di `ChatScreen` dihapus; ringkasan "Selesai · durasi · N langkah" untuk jawaban lama dari data run tersimpan (durasi hanya untuk status completed/failed/cancelled, tidak dikarang); fake e2e `[skenario:tool]`, `[skenario:error]`, `[skenario:izin]`. Detail: `docs/RUN_ACTIVITY.md` ("Tampilan di chat (P2)").

Catatan jujur:
- Ambang selesai "chat selesai berubah minimal 10% dibanding p1" **tidak tercapai**: 0,55% (ambang kanal 24) atau 4,4% (ambang 4). Layar itu pesan teks biasa tanpa tool, jadi hanya Orb dan satu baris ringkasan yang berubah. Perubahan besar ada di layar skenario baru yang tidak punya padanan di p1. Syarat visual lain terpenuhi: pada gambar "saat berjalan" baris aktivitas berada di kolom jawaban dengan Orb di avatar.
- Rencana (todo) tetap tampil di AgentHud sepanjang P2 karena panel Progres belum ada; dipindah di P2B.
- Gambar P2 di `docs/screenshots/p2/` diambil sebelum perbaikan durasi langkah "0 ms" dan sebelum PNG uji yang valid; gambar P2 terbaru ada di `p2b/` (layar skenario yang sama).

## P2B — Panel Progres (2026-11-02)

Cabang `fix/p2b-progres` (dari ujung P2). Tidak digabung ke `main`.

### Perubahan

- Kontrak (tambahan saja): event `context.used` (skill, memori: jumlah dan judul ≤ 40 karakter, lampiran: nama berkas, engine, model); `GET /conversations/:id/progress` (`plan`, `outputs` maks. 50, `used`); `openapi.json` dan `API_CONTRACT.md` diperbarui.
- Gateway: runner mengirim `context.used` setelah role dan skill dipilih dan memori dibaca; ringkasan memori `MemoryService.summary()` (judul singkat, bukan isi); agregat progres dari event run tersimpan (`modules/chat/progress.ts`, tanpa tabel baru); `LaunchInput.attachments`.
- Roles: skill `plan-progress` untuk agent project (omp); AgentHud tidak lagi menampilkan rencana.
- Desktop: `buildProgress` (`realtime/progress.ts`) + fixture emas `packages/contracts/fixtures/progress/` (4 skenario); `LiveRun.contextUsed`; tab Progres (pertama) dengan linimasa, kartu Output, Digunakan, empat state; chip "Langkah N dari M" di Topbar (angka bergulir 180 ms); pintasan `Ctrl+.`; `ArtifactLightbox` dipisah dari `RunActivity`.
- e2e: `[skenario:rencana]` (Hermes palsu menyisipkan context.used, 9 langkah tiap 600 ms, 2 artifact, diff ke event store gateway); `AuthEnv.files` dan `activeRunId`; shim HTTP e2e memakai base64 untuk respons (unduhan biner sebelumnya rusak).
- Bug yang ditangkap tes: regex `memoryTitle` kehilangan backslash (mengganti huruf "s" dengan spasi); tes integrasi progres menangkapnya.

### Bukti tersambung

```
ProgressPanel:  panes/PaneArea.tsx (PaneContent 'progress'), tab pertama PANE_TABS
ProgressChip:   shell/Topbar.tsx (layar chat), klik -> openPanel('progress')
buildProgress:  chat/useProgressView.ts -> ProgressPanel dan ProgressChip
context.used:   gateway runs/runner.ts (emitContextUsed) -> liveRun.ts -> progress.ts
getConversationProgress: api/gateway.ts -> api/queries.ts -> useProgressView
TodoPanel:      dihapus; rencana hanya di panel Progres
```

### Bukti visual

`docs/screenshots/p2b/` (44 gambar, cap `3c399d2`): `<tema>-progres-langkah7`, `-progres-selesai`, `-progres-sebelumnya-dibuka`, serta layar skenario chat (`chat-tool3`, `chat-tool3-dibuka`, `chat-tool-selesai`, `chat-error`, `chat-izin`). Perbandingan p2b vs p1 (ambang kanal 24 | 4): chat-kosong 0,00% | 0,00%, chat-selesai 0,55% | 4,38%, panel-kanan 0,57% | 3,10%; tiga layar progres per tema dan layar skenario tidak punya padanan di p1 (hanya di B).

### Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| typecheck, eslint + prettier | lulus |
| contracts / roles / adapters / ui-tokens | 149 / 41 / 102 (+2 dilewati) / 28 lulus |
| desktop | 93 file, 879 tes lulus |
| gateway | run penuh terakhir: 625 lulus, 3 gagal. Dua diperbarui karena perilaku baru (urutan event memuat `context.used`; skill `plan-progress` di daftar role) dan lulus 27/27 setelahnya. `fleets` ("status failed") flaky: lulus 6/6 sendirian. Gateway penuh belum dijalankan ulang setelah dua perbaikan itu |
| tes integrasi progres (Postgres) | 11 lulus |
| e2e desktop | run penuh terakhir 31 lulus, 2 gagal (`shell.spec`: sampel frame pelat dan panel) yang lulus 12/12 saat `shell.spec.ts` dijalankan sendirian (flaky saat mesin berbeban). Run penuh sebelumnya 33/33 |

### Tidak diverifikasi

- Perilaku agent omp sungguhan mengikuti skill `plan-progress` (butuh omp dan model nyata); tes hanya memeriksa isi skill dan pemuatannya.
- Konektor MCP (dikenali dari awalan nama tool `mcp__`).
- Panel Progres di Android (P6).
- Judul fakta memori berasal dari 40 karakter pertama teks fakta (lihat BACKLOG "Temuan P2B").

## P3 — Bug kecil (2026-11-02)

Cabang `fix/p3-bug-kecil` (dari ujung P2B). Tidak digabung ke `main`.

### Butir

| # | Perbaikan | Tes |
| --- | --- | --- |
| 1 | `TextField`: input selalu `w-full` (sebelumnya hanya bila ada `trailing`), sehingga alamat server dan kode TOTP tidak lagi setengah lebar | `ui/TextField.test.tsx`; e2e `login.spec` mengukur `boundingBox` ketiga input |
| 2 | Kuota sidebar: `quotaLabel()` null bila tidak ada token (baris dan ikon disembunyikan), biaya hanya bila di atas 0 | `shell/ShellInfo.test.tsx` (5 kasus) |
| 3 | Chip "Otomatis · Otomatis" sudah hilang sejak Topbar P1. Chip model otomatis kini bertooltip; label kanban "Otomatis" menjadi "Agent otomatis" dengan penjelasan; teks `status.role/model` yang mati dihapus | `Topbar.test.tsx`, `Kanban.test.tsx` |
| 4 | Keterangan model hanya dari data server: "Kombinasi · coding-main", "Model · openai · gpt-x" (jenis, penyedia bila menambah informasi, id). Tidak ada kalimat karangan, tidak ada kalimat sama untuk semua kombinasi | `Settings.test.tsx`, `modelFacts.test.ts` |
| 5 | Chat umum (Hermes): pemilih model di composer nonaktif dengan teks "Model diatur di server Hermes"; di project (omp) tetap aktif | `Composer.test.tsx`, `ChatScreen.test.tsx` |
| 6 | `dshTestIdentity()` dan `prepareDshRoot()` mengisi `DSH_UID/GID` uji hanya saat `getuid() === 0`; `afterAll` aman bila `beforeAll` gagal. Pemeriksaan keamanan di `launch.ts` TIDAK diubah; tesnya ("menolak berjalan sebagai root tanpa DSH_UID") tetap ada. Balapan `waiting_approval` di tes dsh diperbaiki dengan menunggu status | `testing/dsh-identity.test.ts` (4 kasus), `dsh.integration.test.ts` 3 kali lulus |
| 7 | `schedule.spec.ts`: kegagalan di BACKLOG Sesi 6 tidak terulang di 7 run suite penuh; tes dipertegas (tunggu URL detail jadwal, pemilih di `main`, toast tepat). Dua tes animasi `shell.spec` yang gagal berulang di suite penuh ditulis ulang lewat Web Animations API (jeda animasi dan geser `currentTime`), tidak bergantung frame rate | tiga run suite penuh berturut-turut: 34/34, 34/34, 34/34 |
| 8 | `/projects`: sidebar (`WorkspaceSidebar addInMain`) hanya menawarkan muat ulang, area utama punya satu tombol (header hanya bila sudah ada project). `/spaces`: sidebar tidak menggandakan formulir buat ruang | `Projects.test.tsx`, `Spaces.test.tsx`, `WorkspaceSidebar.test.tsx` |
| 9 | xterm memakai `--font-mono` (Geist Mono) dan dibuat SETELAH `document.fonts.load` dan `ready`; font gagal tetap membuka terminal; ditinggalkan sebelum font siap tidak membuat terminal | `terminal/Terminal.test.tsx` (4 kasus baru) |

Butir 4 dan 5 ada di satu commit karena sama-sama mengubah `copy.ts`.

### Bukti visual

`docs/screenshots/p3/` (44 gambar, cap `3565db3`), dibandingkan dengan `p2b/` (sebelum). Login gelap: sebelumnya server dan TOTP selebar sekitar 210 px, sesudahnya ketiganya 334 px. Chat kosong: baris "Kuota 0 token · $0,00" hilang, pemilih model terkunci. Persentase piksel berbeda (ambang kanal 24 | 4): login 0,11 | 0,12; chat-kosong 0,34 | 1,17; pengaturan-atas 0,84 | 1,22; project 0,33 | 0,66; ruang 0,31 | 0,65 (tema gelap).

### Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| typecheck, eslint + prettier | lulus |
| contracts / roles / adapters / ui-tokens | 149 / 41 / 102 (+2 dilewati) / 28 |
| desktop | 96 file, 900 tes lulus |
| gateway | 62 file, 632 tes lulus (13 dilewati sejak awal) |
| worker | 19 file, 282 tes lulus |
| e2e desktop, 3 run penuh berturut-turut | 34/34, 34/34, 34/34 |

### Tidak diverifikasi

- Tes dsh sebagai root sungguhan (mesin ini Windows). Yang diuji: pembantu `dshTestIdentity` dan bahwa peluncur produksi menerima identitas itu serta tetap menolak root tanpa `DSH_UID`. Perilaku `chown` pada `prepareDshRoot` hanya berjalan di Linux sebagai root.
- Kegagalan `schedule.spec` di suite penuh tidak bisa direproduksi, jadi perbaikannya defensif.

## P4 — Fitur tersambung (2026-11-02)

Cabang `fix/p4-fitur-tersambung` (dari ujung P3). Tidak digabung ke `main`. dsh tetap opsional dan mati secara bawaan; tidak ada dependensi baru; kontrak hanya ditambah.

### A. Jawaban kaya untuk semua role

- `rich-answers` jadi skill inti (`CORE_SKILLS` 5 menjadi 6), dimuat untuk semua role di chat umum dan project, pada omp, Hermes, dan dsh (runner memakai `roles.bundle` untuk semua mesin). Keluar dari paket `frontend`. Tes roles diperbarui sesuai aturan baru (skill inti, bukan pengecualian yatim); gateway menegaskan skill itu ada di pesan sistem Hermes.
- Isi skill: komponen menurut isi (perbandingan, deret angka, pilihan, langkah, angka penting), kapan TIDAK dipakai, maksimal 3 komponen, contoh benar dan salah, dan perbandingan harus blok `aios-ui`, bukan tabel Markdown.
- e2e `[skenario:kaya]` (`e2e/tests/rich.spec.ts`): tabel, grafik, checklist tampil; blok rusak tampil sebagai kode; sama setelah muat ulang.
- omp sungguhan ("Bandingkan 3 opsi database untuk aplikasi kecil dalam tabel", bundel role `general`, `omp -p --no-tools`): percobaan 1 menjawab tabel Markdown biasa (skill belum tegas), percobaan 2 habis waktu, percobaan 3 setelah penegasan menghasilkan blok `aios-ui` tipe `table` yang valid menurut `RichAnswerSchema`. Teks di `docs/bukti-p4/`. Screenshot aplikasi dari keluaran nyata tidak diambil.

### B. Pilihan mesin

- Kontrak: `EngineInfo` ditambah `reason?`, `supportsModelPick`, `supportsTodo`. `GET /engines` melaporkan `hermes` (health check), `omp` (worker tersambung), `dsh` (`DSH_COMMAND` terisi DAN jabat tangan ACP lulus; `probeAcp` di `packages/adapters`, cache 30 detik). Alasan ke klien umum, rincian galat ke log.
- Desktop: pemilih mesin di composer (Otomatis, omp, Hermes, dsh), nonaktif dengan alasan (dari gateway atau konteks), dsh berlabel Pratinjau dengan tooltip "belum diaudit", tersimpan per percakapan (maks. 100), dipindah dari kunci chat baru ke id percakapan. Pemilih model mengikuti `supportsModelPick`. Hanya `engine: 'dsh'` yang dikirim; Otomatis, omp, Hermes mengikuti konteks.
- e2e `engine.spec.ts` dengan `fake-dsh.mjs` lewat peluncur produksi: pilih dsh, kirim tugas, setujui izin, baris aktivitas dan panel Progres (mesin dsh) terisi, pilihan bertahan setelah muat ulang.

### C. Thumbnail bukti

- e2e `[skenario:screenshot]` (`thumbnail.spec.ts`): PNG nyata dan SVG lewat modul files; thumbnail di baris aktivitas dan Output Progres; klik membuka lightbox, Esc menutup; tahan muat ulang; SVG sebagai berkas.
- Dua celah ditemukan e2e dan diperbaiki: jawaban tersimpan tanpa langkah tool tidak punya baris aktivitas dan thumbnail (kini dari agregat progress), dan SVG diklasifikasikan sebagai gambar (kini `isRasterImageMime` di kontrak, dipakai gateway dan desktop).

### Bukti visual

`docs/screenshots/p4/` (44 gambar, cap `09e0426`) vs `p3/`: chat kosong 0,21% (gelap dan terang), chat selesai 0,75-0,80%. Perubahan: pil "Mesin otomatis" di composer.

### Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| typecheck, eslint + prettier | lulus |
| contracts / roles / adapters / ui-tokens | 151 / 46 / 106 (+2 dilewati) / 28 |
| desktop | 98 file, 919 tes |
| gateway | 63 file, 639 tes (13 dilewati sejak awal) |
| worker | 19 file, 282 tes (dua run pertama gagal di `files.test.ts` saat beban, lulus sendirian dan di run ketiga; `apps/worker` tidak diubah P4) |
| e2e desktop, run penuh | 38/38 |

### Tidak diverifikasi

- dsh sungguhan di VPS (hanya dsh palsu).
- Screenshot aplikasi dari keluaran omp nyata; efek penegasan skill hanya dicoba satu kali (hasil model bisa bervariasi).
- Rendering Hermes nyata dengan skill baru.

## P4b — Mesin dipaksa dan sisa P3 (2026-11-02)

Cabang `fix/p4b-mesin-dipaksa` (dari ujung P4). Tidak digabung ke `main`. Keputusan pengguna: (1) perluas agar mesin bisa dipaksa, (2) 9Router di VPS boleh dipakai untuk percobaan omp, (3) lanjutkan sisa P3.

- **Mesin dipaksa:** `SendMessageRequest.engine` jadi `hermes | omp | dsh` (kontrak, perluasan). Gateway memvalidasi konteks: `omp` di chat umum 422 `project_required`, `dsh` di project 422 `engine_not_for_project`, `hermes` di dalam project dijawab Hermes lewat agent umum (router dipanggil tanpa project). Klien mengirim pilihan eksplisit (Otomatis tidak mengirim apa pun); Hermes kini bisa dipilih di project dan mengunci pemilih model. Tes: `engine-force.integration.test.ts` (5), `engineChoice.test.ts`, `EnginePicker.test.tsx`; tes dsh lama "engine selain dsh ditolak skema" diperbarui (nilai tak dikenal tetap 400).
- **Chip agent di Topbar:** tampil hanya setelah ada run (agent terakhir yang menjawab), dengan tooltip penjelasan. Tes di `Topbar.test.tsx`.
- **Pengaturan model:** keterangan cakupan (berlaku untuk omp dan dsh; chat umum lewat Hermes memakai model server). Tes di `Settings.test.tsx`.
- **ProjectList mati dihapus:** komponen dan dua tes khusus komponen itu; perilaku produksi sudah dicakup `ProjectRoutes.test.tsx`.

### Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| typecheck, eslint + prettier | lulus |
| desktop | 98 file, 919 tes |
| gateway | 64 file; 643 lulus pada run penuh, satu tes lama diperbarui lalu modul dsh 14 lulus |
| e2e desktop, run penuh | 38/38 |

### Tidak diverifikasi

- Hermes nyata dengan mesin dipaksa di dalam project (hanya Hermes palsu).
- Run gateway penuh ulang setelah perbaikan tes dsh (hanya modul dsh yang diulang).

## P5 — Hermes (2026-11-03)

Cabang `fix/p5-hermes` (dari ujung `fix/p4b-mesin-dipaksa`). Tidak digabung ke `main` (ditunda sampai semua sesi selesai, keputusan pengguna). Berbeda dari sesi lain: tidak ada rekaman Hermes sebelumnya di repo maupun git history manapun (dicek `git log --all -- 'packages/adapters/fixtures/hermes/*'`, kosong), jadi sesi berhenti dan meminta klarifikasi sebelum menulis kode. Pengguna mengonfirmasi Hermes hidup di VPS tempat repo ini berjalan (`127.0.0.1:8642`, key di `~/.hermes/.env`), sehingga rekaman direkam langsung di sini, bukan disimulasikan.

### A. Rekaman

7 rekaman `curl -N` nyata terhadap Hermes 0.22.5 (`health` melaporkan versi), toolset aktif hanya `terminal`/`file`/`vision`/`skills` (web/browser mati): `packages/adapters/fixtures/hermes/{plain-text,reasoning,tool-success,tool-failure,tool-sequence,cancel-mid-tool,model-override}.sse`. Diperiksa sebelum commit: tidak ada API key/token di berkas (hanya di header `Authorization` request, tidak pernah di body SSE), hanya prompt generik tanpa data pribadi. `hermes.replay.test.ts` tidak lagi skip: 7/7 lulus, snapshot di `src/__snapshots__/hermes.replay.test.ts.snap`.

Temuan dari rekaman (detail: `docs/ADAPTER_EVENTS.md`):
1. Pemetaan `hermes.tool.progress` yang ada (Sesi 2) **sudah benar** terhadap bentuk nyata (`tool`, `label`→target, `toolCallId` selalu ada, `status: running|completed`) — tidak ada bug, hanya komentar "belum terverifikasi" yang dikoreksi.
2. **Status `hermes.tool.progress` HANYA pernah `running`/`completed`**, tidak pernah `failed`/`error`, bahkan untuk perintah exit code ≠0 (`ls` ke folder tak ada): Hermes melapor `completed` dan menaruh galat di teks jawaban. Payload `completed` **tidak pernah** membawa `output`/`result`.
3. **Hermes dapat menggabungkan beberapa perintah shell jadi satu panggilan tool** (dua `echo` berurutan → satu `running`/`completed` dengan label `"... + 1 command"`).
4. **`reasoning_content` TERBUKTI dikirim Hermes VPS ini** (2 dari 4 giliran yang memanggil tool), tapi tidak konsisten dan tidak pernah muncul di giliran teks biasa tanpa tool (diuji 3x, termasuk soal matematika yang diminta berpikir langkah demi langkah).
5. **Pembatalan: server TIDAK berhenti saat koneksi diputus.** Uji: `sleep 8 && touch <marker>` lewat tool terminal; proses `curl` di-SIGKILL tepat setelah event `running` (sebelum `completed`); berkas marker tetap muncul ~8 detik kemudian di server. `POST /v1/runs/{id}/stop` **tidak bisa dipakai** dari adapter ini: `/v1/chat/completions` tidak mengembalikan run id apa pun (diperiksa header via `curl -D -`). Mengatasi ini butuh pindah transport ke jalur `/v1/runs` — keputusan arsitektur di luar cakupan sesi ini (BACKLOG "Temuan Sesi P5").
6. `model-override.sse`: field `model` klien dipantulkan di respons tapi token usage identik model bawaan untuk pertanyaan sejenis, konsisten dokumen (diabaikan tanpa `direct_model_requests`); tidak dikonfirmasi langsung (butuh ubah config Hermes).

### B. Perubahan kode

- `packages/adapters/src/hermes.ts`: komentar pada `onToolProgress` dan docstring adapter dikoreksi sesuai bukti rekaman (lihat atas); **tidak ada perubahan logika pemetaan** (sudah benar).
- `packages/adapters/src/hermes.replay.test.ts`: jam deterministik (`now: () => (t += 250)`, pola sama dengan `hermes.test.ts`) ditambahkan ke `replay()` agar `durationMs` di snapshot tidak flaky (sebelumnya 0 atau 1 ms tergantung CPU).
- `apps/desktop/src/realtime/activity.ts`: komentar `TOOL_KINDS` dikoreksi — `terminal` kini terverifikasi rekaman Hermes (kalimat "Menjalankan perintah" tepat); tidak ada perubahan pemetaan (sudah benar).
- `docs/ADAPTER_EVENTS.md`, `docs/BACKLOG.md`: ditulis ulang sesuai bukti rekaman (lihat A).

### Bukti tersambung

```
onToolProgress dipakai:  hermes.ts:249 (if (msg.event === 'hermes.tool.progress') yield* onToolProgress(...))
TOOL_KINDS['terminal']:  activity.ts:61 -> 'command' -> copy.ts:578 "Menjalankan perintah"
hermes.replay.test.ts:   mengimpor createHermesAdapter dari hermes.ts (bukan tiruan), 7 fixture nyata diputar
```

### Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| `pnpm typecheck` | lulus (12/12 paket; gap `unpdf` pre-existing diperbaiki dengan `pnpm install --frozen-lockfile`, tidak menambah dependensi baru) |
| `pnpm lint` (eslint + prettier) | lulus |
| adapters | 7 file, 113 lulus, 1 dilewati sejak awal (`dsh asli`, butuh binary dsh) — stabil 3x run berturut-turut |
| contracts / roles / ui-tokens | 151 / 46 / 28 lulus |
| desktop | 98 file, 919 tes lulus |
| gateway / worker / e2e | **tidak bisa dijalankan**: Postgres tertanam gagal start di VPS ARM64 ini (`libicuuc.so.60` tidak ada; hanya `libicu74` terpasang, ABI tidak kompatibel dengan binary `@embedded-postgres/linux-arm64`). Dikonfirmasi pre-existing (`git stash` lalu uji ulang: gagal sama, tidak terkait perubahan sesi ini) |

### Tidak diverifikasi

- Gateway/worker/e2e penuh (lihat tabel Pemeriksaan): environment VPS ini tidak bisa menjalankan Postgres tertanam. Tidak diperbaiki (di luar cakupan P5, perbaikan ICU/binary Postgres butuh keputusan terpisah).
- `direct_model_requests` on/off di Hermes (butuh ubah config Hermes di VPS, sesi ini hanya membaca).
- Penyebab pasti `reasoning_content` tidak konsisten (keputusan model, bukan diselidiki lebih lanjut).
- Tool selain `terminal` (`web_search`, `browser_*`, `read_file`, dll): toolset itu mati di konfigurasi Hermes VPS ini.
- Bukti visual: sesi ini tidak mengubah UI (hanya komentar), jadi `pnpm shots` tidak dijalankan (tidak relevan, tidak ada perubahan tampilan untuk dipotret).

## P6 — Android (2026-11-03)

Cabang `fix/p6-android` (dari ujung `fix/p4b-mesin-dipaksa`). Tidak digabung ke `main` (ditunda). JDK: OpenJDK 17.0.20.1 (`/usr/lib/jvm/java-17-openjdk-arm64`), sesuai syarat README (17–21). SDK Android dipasang manual di `/tmp/androidsdk` (platform 36 + build-tools 36 ditambahkan di sesi ini; sebelumnya hanya ada platform 35).

### A. Lingkungan: emulator/instrumentasi TIDAK MUNGKIN di VPS ini

Dibuktikan, bukan diasumsikan: tidak ada `/dev/kvm`, tidak ada modul kernel `kvm`, dan `sdkmanager --install emulator` gagal dengan `Failed to find package 'emulator'` (tidak ada paket emulator untuk host ARM64 di repository yang dipakai cmdline-tools versi ini). Konsekuensi: `RunActivityTest`, `FloatingNavBarTest`, `ActivityScreenshotsTest`, `AiosE2ETest` (semua di `androidTest/`) dan screenshot emulator (tugas 8) **tidak bisa dijalankan di sini**. Build debug dan tes unit JVM (`test/`) tidak terpengaruh dan dijalankan nyata (lihat Pemeriksaan).

### B. Perubahan

1. **Build dari main + cap build (tugas 1, 2):** `assembleDebug` dan `testDebugUnitTest`/`testReleaseUnitTest` dijalankan nyata. `build.gradle.kts`: `buildConfigField BUILD_COMMIT` (hash commit git pendek + `-kotor` bila ada perubahan belum di-commit, dari `git rev-parse --short HEAD` dan `git status --porcelain` saat konfigurasi Gradle). Ditampilkan di `SettingsScreen.kt` (bagian baru "Tentang"), bersama versi aplikasi (dipindah dari bagian "Perangkat" agar tidak dobel).
2. **Panel izin (tugas 3):** kontrak `approval.requested`/`approval.resolved` diperkaya sesuai skema (`kind`, `detail`, `cwd`, `toolCallId`, `decision`, `remember`) di `Frames.kt` dan `RunTrace.kt` (`TraceApproval`, bukan sekadar ID). `ApprovalPanel.kt` (baru): detail persis, folder kerja bila ada, tiga tombol (Izinkan sekali/Selalu/Tolak, target sentuh `Tokens.touchTarget` = 48 dp), seluruh panel satu blok semantik (`mergeDescendants`) sehingga TalkBack membacakan judul + detail + folder kerja sebagai satu pengumuman sebelum tombol. `ChatViewModel.resolveApproval` → `ChatRepository.resolveApproval` → `POST /runs/{runId}/approvals/{approvalId}` (kontrak yang sudah ada, `ApprovalDecisionRequestSchema`/`ApprovalSchema`). Wiring nyata di `ChatScreen.kt` (bukan hanya dipanggil dari tes).
3. **`tool.output` (tugas 4):** `Frames.kt` memetakan `ServerEvent.ToolOutput` (sebelumnya jatuh ke `Other`); `RunTrace`/`LiveRun` menyimpan baris terakhir non-kosong (`output`, sama dengan aturan desktop `liveRun.ts`: `chunk.split(/\r?\n/).filter(Boolean).at(-1)`).
4. **Panel Progres (tugas 5, paritas P2B):** `ProgressBuilder.kt` (baru) — port Kotlin murni dari `apps/desktop/src/realtime/progress.ts` (`buildProgress`), diuji dengan **fixture JSON yang SAMA** dengan desktop (`packages/contracts/fixtures/progress/*.json`, sudah tersedia di classpath tes lewat `sourceSets.test.resources` yang sudah ada sejak Sesi 8) di `ProgressBuilderTest.kt`: 4 fixture (`plan-midway`, `hermes-no-plan`, `reload-complete`, `blocked-and-abandoned`), replay event lewat `Frames.parse` yang sama dengan aplikasi, dibandingkan `steps`/`chip`/`used`/`outputs` persis. `Frames.kt` diperluas dengan `ServerEvent.TodoUpdated` dan `ServerEvent.ContextUsed` (keduanya sebelumnya jatuh ke `Other`) agar rencana dan konteks live bisa dibaca. `ProgressDto.kt` (baru): model `GET /conversations/:id/progress` sesuai `ConversationProgressSchema` (kontrak yang sudah ada, tidak diubah). Chip "Langkah N dari M" (atau "Langkah N" tanpa total) di topbar chat (`MainScreen.kt`, parameter baru `progressChip` pada `TopBar`), ketuk membuka `ProgressSheet.kt` (baru, `ModalBottomSheet`): Progres (linimasa, "N langkah sebelumnya"), Output (daftar, ketuk — pratinjau penuh belum diimplementasikan, lihat Tidak diverifikasi), Digunakan dalam sesi ini. Data `progressResponse` diambil `ChatViewModel` dari server setiap kali pesan disegarkan dan setiap run selesai (`refreshProgress`), sehingga **bertahan setelah aplikasi dibuka ulang** — menutup BACKLOG "RunTrace tidak bertahan" untuk bagian Progres (RunTrace itu sendiri, data run yang sedang mengalir, tetap tidak persisten by design, sama seperti desktop).
5. **AgentOrb (tugas 6):** sudah terpenuhi tanpa perubahan kode (lihat Bukti tersambung).
6. **CI (tugas 7):** `build.yml` job `android` sudah menjalankan `./gradlew check` (ktlint, detekt, lint Android, `testDebugUnitTest`) di setiap push/PR; ditambah komentar yang menjelaskan mengapa tanpa instrumentasi (runner GitHub Actions bawaan tidak punya emulator terpasang; dibuktikan sesi ini VPS pengembangan juga tidak bisa memasangnya di ARM64).
7. **Screenshot (tugas 8):** **tidak bisa dijalankan** (lihat bagian A).

### Bukti tersambung

```
ApprovalPanel dipakai: ChatScreen.kt:151 (ui.trace?.approvals?.forEach { ApprovalPanel(...) })
ProgressSheet dipakai: MainScreen.kt:345 (if (progressSheetOpen && progressView != null) ProgressSheet(...))
ProgressChip dipakai:  MainScreen.kt:229-231 (progressChip = progressView?.chip?.let { ... })
buildProgress dipakai: MainScreen.kt:136 (progressView = buildProgress(chatUi.progressResponse, chatUi.trace, ...))
AgentOrb (sudah ada sebelum sesi ini, diverifikasi ulang):
  avatar:  ChatMessages.kt:354 AgentOrb(phase = orbPhase, size = OrbSizeCompact, ...)
  topbar:  MainScreen.kt (TopBar) baris ~400 AgentOrb(phase = orbPhase, ...)
```

### Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL; `BuildConfig.BUILD_COMMIT` terverifikasi berisi hash commit nyata (`fc4f595-kotor` saat working tree masih kotor) |
| `./gradlew check` (ktlint, detekt, lint Android, tes unit debug+release) | BUILD SUCCESSFUL |
| tes unit JVM (debug dan release) | 203 lulus, 0 gagal, masing-masing (termasuk `ProgressBuilderTest` baru, 4 fixture + 2 tes tambahan) |
| Android lint | 0 error, 126 warning (pre-existing, tidak diperiksa satu-satu) |
| tes instrumentasi (`androidTest`) | **tidak dijalankan** — lihat bagian A |

### Tidak diverifikasi

- Tes instrumentasi (`RunActivityTest`, `FloatingNavBarTest`, `ActivityScreenshotsTest`, `AiosE2ETest`) dan screenshot emulator (tugas 8): lingkungan VPS ini tidak punya KVM dan tidak bisa memasang paket emulator (dibuktikan, bukan diasumsikan; lihat bagian A). Tidak diverifikasi di perangkat/CI lain.
- TalkBack sungguhan atas `ApprovalPanel` (hanya diverifikasi lewat struktur semantics di kode; tidak ada perangkat/emulator untuk mendengarkan pembacaan nyata).
- Font 200% pada `ApprovalPanel`/`ProgressSheet` secara visual (tidak ada emulator; komponen memakai token `Tokens.touchTarget`/teks Compose yang mengikuti `fontScale` sistem secara otomatis, tapi tidak diperiksa dengan mata).
- Pratinjau penuh saat kartu Output di `ProgressSheet` diketuk (saat ini hanya menutup sheet; integrasi ke `ArtifactDialog`/lightbox yang sudah ada di chat tidak dikerjakan, di luar anggaran waktu sesi ini).
- `ResourceActivityTexts` dan `buildProgress` di `MainScreen.kt` dipanggil ulang tiap recomposition tanpa `remember` eksplisit pada hasilnya (hanya `activityTexts` yang di-`remember`); berpotensi dihitung ulang lebih sering dari perlu — tidak diukur dampak performanya.
- Konektor MCP dan grup tool `web`/`browser` di panel Progres Android: logikanya ada (port dari desktop) tapi belum teramati dengan data nyata (sama seperti P5, toolset itu mati di Hermes VPS; omp project belum diuji dengan tool MCP di Android).

## P7 — ORCA Lead->Worker, Tahap 1 (backend) + Tahap 2 (UI desktop) (2026-11-05)

Cabang kerja: `fix/p7-orca-lead-worker`, `fix/p7b-orca-sisa`, `fix/p7c-orca-ui-tahap2` (semua dari ujung `fix/p4b-mesin-dipaksa`, digabung balik berurutan). Tidak digabung ke `main` (ditunda sampai semua sesi P0-P8 selesai, sesuai aturan sejak P5). Hash gabungan terakhir: `54eb2c4`.

12 keputusan pemilik atas pertanyaan terbuka `ORCA_DESIGN.md` dicatat verbatim di awal sesi (lihat riwayat percakapan); yang relevan untuk catatan ini: Lead berjalan di VPS lewat Hermes (bukan omp/worker); satu Worker aktif per tim (slot global in-process, bukan durable lintas proses — gateway satu proses, konsisten dengan keputusan "restart tidak auto-resume"); diff per Worker tanpa auto-merge; restart gateway/Lead mati -> `needs_attention` + intervensi pemilik; e2e memakai fake adapters yang harus benar-benar diimplementasikan (bukan stub kosong).

### Temuan lingkungan penting: Postgres tertanam tetap rusak, tapi ditemukan jalan keluar

Sama seperti P5: Postgres tertanam (`@embedded-postgres`) masih gagal start di VPS ARM64 ini (ICU tidak kompatibel). **Berbeda dari P5/P6**: ditemukan Postgres asli (`postgresql-16` dari apt) sudah terpasang; dibuat instance disposable sendiri (`initdb`+`pg_ctl` di scratch dir, port terpisah, **bukan** database produksi personal-ai-os sungguhan yang kebetulan juga berjalan di port 5432 pada host ini — diverifikasi dan dihindari secara sengaja). `TEST_DATABASE_URL` diarahkan ke instance disposable ini, yang dihormati `global-setup.ts` gateway (melewati jalur tertanam sepenuhnya). **Ini membuka jalan verifikasi nyata untuk SEMUA tes gateway berbasis DB di VPS ini**, sesuatu yang pada P5/P6 dianggap tidak mungkin. Dicatat sebagai skill (`integration-test-database`) untuk sesi berikutnya.

### A. Tahap 1 — Backend (apps/gateway/src/modules/teams/orchestrator.ts, baru)

1. **Model data tambahan (additive):** migrasi `0014_blushing_vision.sql` (`team_assignments`, `team_reviews`, kolom `teams.plan`) dan `0015_silent_silk_fever.sql` (`conversations.team_id`, kolom biasa BUKAN FK — FK eksplisit menimbulkan siklus tipe `conversations->teams->runs->conversations` yang merusak inferensi TypeScript lintas paket `@aios/e2e`, terbukti saat dicoba dan diperbaiki).
2. **Lead merencanakan terstruktur:** skill baru `packages/roles/skills/orca-lead/SKILL.md` (pola `never-match`, tidak terpilih otomatis); protokol blok ` ```orca-plan`/` ```orca-review` ; gateway memvalidasi tidak kosong, maks `MAX_TEAM_PLAN_TASKS`, ada kriteria selesai per tugas. Lead dipaksa `engine: 'hermes', skills: ['orca-lead']` saat dibuat (bug nyata ditemukan dan diperbaiki: sebelumnya bisa default ke omp, bertentangan keputusan pemilik).
3. **Orkestrator pg-boss:** menjalankan assignment satu per satu (konkurensi dari `team.limits.maxWorkers`, slot global `createSemaphore`), tiap Worker memakai run+worktree lewat infrastruktur coding yang **SUDAH ADA** (`chat.sendMessage`, `runsService.cancel/review`) — **tidak** diimplementasikan ulang. `timeoutMs` per-run mengalir end-to-end: kontrak `RunStartCommandSchema.timeoutMs` (sudah ada) -> `AgentRunInput.timeoutMs` (baru, `packages/adapters`) -> `worker-relay.ts` -> `apps/worker/coordinator.ts` (timer per-run, bukan hanya default 30 menit global) -> `LaunchInput.timeoutMs` (gateway `runner.ts`) -> `ChatService.sendMessage` options -> orchestrator kirim `memberTimeoutMinutes * 60000`.
4. **Review Lead:** accept/revise (maks `maxReviewRounds`)/reject lewat `runsService.review()` yang sudah ada, **selalu `merge: false`** — hasil tidak pernah digabung otomatis ke project; pemilik memutuskan di luar tim.
5. **Batas waktu/langkah/token ditegakkan dengan menghentikan proses sungguhan**, dibuktikan: `waitForRun()` memanggil `runsService.cancel(runId)` nyata saat `memberTimeoutMinutes`/`stepsPerMember`/`tokensPerMember` terlampaui — bukan hanya tanda di database. Pembatalan tim merambat ke Worker aktif (bug nyata ditemukan dan diperbaiki: `teams/service.ts` `cancel()` sebelumnya hanya membatalkan run Lead). Restart gateway tidak menghilangkan tim: `orchestrator.start()` menandai tim `running` yatim (tanpa proses JS yang melacaknya) sebagai `needs_attention`/`gateway_restarted`, **tidak** auto-resume.
6. **Dua bug status nyata ditemukan dan diperbaiki** (ditemukan lewat debugging tes, bukan desain awal yang benar): (a) `assistantTextOf()` salah mengambil pesan user bukan jawaban Lead (lupa filter `author='assistant'`); (b) `teams/service.ts` `detail()` menurunkan status tim/anggota dari status run terkait, menimpa nilai eksplisit (`needs_attention` restart) yang ditulis orchestrator — diperbaiki dengan memprioritaskan kolom tersimpan begitu `plan` ada / status eksplisit `needs_attention`.
7. **Bug akar paling krusial:** `actorDeviceId` string buatan (`'orca-orchestrator'`) dipakai di audit log yang kolomnya `uuid`+FK ke `devices.id` — insert gagal di Postgres, error **tertelan diam-diam** oleh job handler pg-boss (tim tampak macet tanpa pesan error apa pun). Diperbaiki: `RunsService.review()` `actorDeviceId` dilonggarkan jadi `string | null`, orchestrator kirim `null` (makna: tidak ada aktor manusia).
8. **Endpoint baru** `POST /teams/:id/members/:memberId/cancel` (hentikan satu anggota tanpa membatalkan seluruh tim), kontrak `TeamMemberParamsSchema` dan `TeamMemberSummary.conversationId`/`TeamDetail.approvals` (additive, lihat bagian B).

### B. Tahap 2 — UI desktop (4 dari 5 tugas; Android belum disentuh)

1. **Tombol "Kerjakan sebagai tim" (tugas 7):** pill opt-in di `Composer.tsx` (pola identik `planMode`), hanya tampil di project + percakapan baru. `useChatController.ts`: cabang baru di `send()` memanggil `api.createTeam()` lalu navigasi otomatis ke percakapan Lead (lewat `TeamMemberSummary.conversationId` baru).
2. **Panel Progres pohon tim (tugas 8):** `TeamProgressTree.tsx` (baru) — Lead + daftar assignment dengan `AgentOrb` per status, tombol Tinjau membuka tab Diff **yang sudah ada** (`openReview(runId)`, bukan UI baru), tombol Hentikan per-anggota dan seluruh tim. `ProgressPanel.tsx` mendeteksi `conversation.teamId` (`useConversation`) dan merender pohon ini menggantikan linimasa biasa.
3. **Persetujuan agregat (tugas 9, DIADAPTASI):** prompt asli minta ini di tab Aktivitas; diputuskan taruh di panel Progres yang sudah jadi permukaan tim-aware (tugas 8), karena tab Aktivitas terikat ketat ke satu run aktif (`useLiveRun`/`chat.approvals`) dan retrofit ke banyak run anggota tim berisiko tinggi untuk sesi ini. Kontrak `TeamApprovalSchema` baru (additive); `teams/service.ts` memetakan `approvalsRows` (sudah dihitung untuk `pendingApprovals`) ke bentuk beranotasi pemilik, tanpa query baru. Tombol Izinkan/Tolak memakai `api.resolveApproval()` **yang sudah ada**.
4. **e2e tim dua tugas (tugas 11):** `e2e/tests/team.spec.ts` (baru) — Playwright **browser sungguhan** (Chromium), omp **sungguhan** untuk Worker (bukan fake WS), Hermes palsu untuk Lead (`e2e/harness/fakes.ts`, skenario `[skenario:tim]` baru). Toggle tim -> rencana 2 tugas -> omp sungguhan minta izin tulis file nyata (SECURITY_OPS: `--approval-mode always-ask`) -> muncul di daftar persetujuan agregat (tugas 9) -> Izinkan -> Lead terima -> tugas 2 -> izin lagi -> terima -> tim selesai -> **branch main repo tidak berubah** (tidak auto-merge, diverifikasi).
5. **Android read-only (tugas 10): TIDAK dikerjakan.** Dicatat sebagai item BACKLOG terbuka.

### Bukti tersambung

```
teamMode/onTeamMode dipakai:  Composer.tsx (pill) <- ChatScreen.tsx (hanya saat inProject && conversationId===undefined)
createTeam dipakai nyata:     useChatController.ts send() (sebelumnya 0 pemakaian produksi sejak kontrak dibuat sesi lalu)
TeamProgressTree dipakai:     ProgressPanel.tsx (team.data ? <TeamProgressTree ...> : <ProgressTimeline ...>)
openReview (sudah ada) dipakai lewat tombol Tinjau: TeamProgressTree.tsx -> useUiStore().openReview(member.runId)
resolveApproval (sudah ada) dipakai lewat daftar agregat: ProgressPanel.tsx resolveTeamApproval() -> api.resolveApproval(runId, approvalId, {decision, remember:false})
cancelTeamMember dipakai nyata: ProgressPanel.tsx cancelMember() (endpoint sudah ada sejak draf awal P7, 0 client sampai sesi ini)
orchestrator.start()/enqueue dipanggil nyata: apps/gateway/src/main.ts (produksi) dan testing/auth-env.ts (opsional, options.teams)
```

### Pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| `pnpm typecheck` (9 paket monorepo) | lulus, nol error |
| `pnpm lint` (eslint+prettier, monorepo) | lulus, nol error |
| `orchestrator.integration.test.ts` (Postgres disposable nyata) | **7/7 lulus**: sukses, Lead reject, pembatalan merambat, Worker mati (timeout nyata), Worker lambat (stepsCap nyata), revisi (percobaan ke-2), restart gateway (`needs_attention`, tidak auto-resume) |
| `orchestrator.parser.test.ts` (murni, tanpa DB) | 7/7 lulus |
| gateway full suite | 654 lulus, 13 skip, 4 gagal (semua **pre-existing**, tidak terkait P7: Postgres trust-auth lokal untuk tes 503, Chromium tidak terpasang untuk render) |
| worker full suite | 282/282 lulus (1 tes `omp.e2e.test.ts` flaky sekali saat beban, lulus 12/12 saat diulang — pre-existing, file tidak tersentuh sesi ini) |
| adapters / contracts / roles full suite | 113/114 (1 skip pre-existing) / 151/151 / 46/46, semua lulus |
| desktop full suite | 923/923 lulus (919 lama + 4 baru sesi ini) |
| e2e `coding.spec.ts` + `chat.spec.ts` (berbagi `fakes.ts` yang diubah) | 8/8 lulus, nol regresi |
| e2e `team.spec.ts` (baru) | lulus bersih 2x berturut (27.8s, 28.0s); gagal 2x saat debugging karena omp sungguhan gagal menjalankan tugasnya (bukan bug kode, lihat BACKLOG) |

### Tidak diverifikasi

- **Android read-only (tugas 10):** tidak dikerjakan sama sekali di sesi ini.
- **Keputusan terbuka Lead-worktree (keputusan pemilik P7 #2):** secara arsitektur tidak bisa lewat Hermes (dibuktikan: request Hermes tidak punya field tools/MCP). Lead tetap meninjau lewat ringkasan teks + `diffStat`, bukan isi diff sungguhan. Dua opsi didokumentasikan di BACKLOG, ditunda atas persetujuan pemilik.
- **Skenario "pembersihan worktree" (ke-8 dari 8):** tidak diduplikasi sebagai tes gateway baru — sudah terbukti oleh `apps/worker/src/runs/coordinator.test.ts` yang ADA (36/36 lulus) karena Orca memakai mekanisme cancel/review yang sama, bukan worktree sendiri.
- **Patch diff sungguhan untuk Lead (bukan hanya `diffStat`):** butuh round-trip protokol baru gateway<->worker (`review.diff`); ditunda atas keputusan pemilik eksplisit sesi ini, dicatat di BACKLOG dengan opsi lengkap.
- **TalkBack/Android untuk fitur tim mana pun:** tidak relevan (Android tidak tersentuh).

## P8 — Gerbang akhir: verifikasi dari nol, bug nyata ditemukan dan diperbaiki (2026-11-06/08)

Cabang kerja: `fix/p4b-mesin-dipaksa` (dari ujung P7, `da7b915`). Hash akhir sesi: `5609247`. **Bukan gerbang rilis** — dua bug nyata ditemukan dan diperbaiki selama verifikasi; tidak ada fitur baru.

### A. Lingkungan verifikasi: Linux ARM64 sungguhan, berbeda dari semua sesi P0–P7 (Windows)

Clone bersih ke folder baru, `pnpm install --frozen-lockfile`, `pnpm build` (7/7), `pnpm typecheck` (12/12), `pnpm lint` (bersih) — semuanya lulus di commit awal `da7b915`/`413d66e`. Postgres 16 asli (`pg_createcluster`, port 5433, disposable, bukan produksi) dipakai lewat `TEST_DATABASE_URL` karena `embedded-postgres` tetap tidak bisa start di ARM64 (ICU, sama seperti P5/P7). Android SDK (`platform-36`, `build-tools;36.0.0`) dipasang dari nol; `./gradlew assembleDebug testDebugUnitTest testReleaseUnitTest` BUILD SUCCESSFUL, 203/203 tes JVM (debug+release) — **tidak tersentuh sesi ini**, dicatat sebagai baseline gerbang.

### B. Bug nyata #1 — balapan `review.apply` vs run selesai (worker)

**Ditemukan**: `omp.e2e.test.ts > hasil diterima...` flaky ~50% saat dijalankan sendirian di VM 2 vCPU ini (jauh lebih sering daripada "sekali saat beban" yang tercatat P7 di mesin Windows). Root cause dibuktikan lewat instrumentasi sementara (dihapus sebelum commit): `RunCoordinator.run.finished` baru `true` setelah `cleanup()` (stop preview, kill proses, cek/hapus worktree pristine) selesai, padahal event `run.completed`/`error` sudah diteruskan ke klien lebih dulu (di dalam loop `for await` yang mendahului `finally { cleanup() }`). Klien yang melihat run "selesai" dan langsung memanggil `accept()`/`reject()` bisa tiba sebelum `cleanup()` menyelesaikan tugasnya, kena `ReviewError('run_active')` yang ditelan `reviewApply()` jadi `frame.ok:false` diam-diam — worktree tidak pernah dihapus.

**Perbaikan** (`apps/worker/src/runs/coordinator.ts`, commit `413d66e`): `run.finished = true` di-set serentak dengan `run.terminal` di titik yang sama persis dengan event penutup diteruskan (`onEvent` run.completed/error, `fail()`, `cancelled()`, timer timeout) — bukan menunggu `cleanup()` penuh. Jaring pengaman tambahan (`apps/worker/src/runs/review.ts`): `assertIdle()` jadi async dengan retry singkat (10×50ms) sebelum menolak. `reviewApply()` kini mencatat lewat `log()` bila `run_active` tetap muncul setelah retry (anomali nyata, bukan balapan sesaat) — tidak ditelan diam-diam. Tes yang sebelumnya tidak memeriksa hasil `reviewApply()` (`omp.e2e.test.ts`, `coordinator.test.ts`) kini memeriksa `result.ok` eksplisit.

**Bukti**: tes yang tadinya flaky, diulang 25× berturut-turut (sendirian + dalam suite penuh 3×) setelah perbaikan: 25/25 lulus. Worker 19/19 file, 282/282 tes. CI (`github.com/Rizky0606/Personal-AI-OS`, run `42190695415`): `check`/`gateway-image`/`e2e-desktop` semua sukses.

### C. Bug nyata #2 — `dshTestIdentity` diam-diam memakai `getuid()` asli (test harness, bukan produksi)

**Ditemukan saat tes gateway dijalankan sungguhan sebagai root di Linux** — belum pernah dilakukan di sesi mana pun sebelumnya (P3 mencatat "mesin ini Windows"). `dshTestIdentity(gatewayUid: number | undefined = process.getuid?.())` memakai default parameter JS, yang hanya berlaku saat argumen persis `undefined`. Tes `dshTestIdentity(undefined)` bermaksud mensimulasikan "tanpa getuid (Windows)" tapi diam-diam dihitung ulang dari `process.getuid?.()` NYATA — saat proses benar-benar root, hasilnya salah.

**Perbaikan** (`apps/gateway/src/testing/dsh-identity.ts` + 3 pemanggil: `dsh.integration.test.ts`, `e2e/harness/stack.ts`, commit `079bd9e` + `5609247`): `gatewayUid` wajib eksplisit di kedua fungsi (`dshTestIdentity`, `prepareDshRoot`), tidak ada lagi default parameter; tiap pemanggil menyimpan `process.getuid?.()` ke variabel lalu mengirimkannya eksplisit. **Catatan proses**: commit pertama (`079bd9e`) melewatkan pemanggil di `e2e/harness/stack.ts`, membuat CI `check` (typecheck) gagal; diperbaiki lewat commit susulan (`5609247`, fast-forward, tanpa menimpa riwayat) setelah ditemukan dari log CI, bukan dari pemeriksaan lokal (`pnpm typecheck` penuh di scratch clone awalnya memakai cache turbo yang tidak menangkap paket `@aios/e2e`).

**Bukti**: `dsh-identity.test.ts` 4/4 lulus sebagai root sungguhan (sebelumnya 1 gagal). CI run `42434146146` (setelah 1× rerun job yang kena flake tak terkait, lihat D): `check`/`gateway-image`/`e2e-desktop` semua sukses.

### D. Temuan lingkungan (bukan bug kode) — dicatat, tidak diperbaiki

- **dsh sebagai root sungguhan di VPS ini masih gagal 6/9 tes `dsh.integration.test.ts`**: `createDshEngine` benar menegakkan "root wajib DSH_UID" lalu drop-privilege ke uid 65534 (`nobody`) untuk menjalankan fake-dsh (Node). Tapi Node di VPS ini terpasang di `/home/ubuntu/.local/bin/node`, dan `/home/ubuntu` bermode `750` — `nobody` (bukan owner/grup) tidak bisa traverse ke situ sama sekali (`sudo -u nobody node ...` → `Permission denied`). **Bukan bug desain sandbox** (image Docker produksi memakai `node:22-bookworm-slim`, Node di `/usr/local/bin`, bukan di folder pengguna) — murni cara Node terpasang di mesin pengembangan ini. Lihat BACKLOG "Temuan P8".
- **Chromium default (`playwright-core`/Playwright test, channel `msedge`) tidak tersedia** di Linux ARM64 ini. `chromium-browser` (snap) gagal dikendalikan Playwright sebagai pengguna biasa (AppArmor confinement memblokir CDP), tapi **berhasil sebagai root** (ditemukan saat verifikasi "test sebagai root" — `render.test.ts` 3 tes yang gagal sebagai pengguna biasa lulus 5/5 sebagai root). Google Chrome resmi (`/opt/google/chrome`, bukan snap) berhasil di kedua mode lewat `E2E_BROWSER=chrome`, dipakai untuk semua `pnpm shots`/`pnpm --filter @aios/e2e e2e` sesi ini.
- **Satu instance Postgres disposable yang dipakai berulang (~10× full-suite) dalam sesi panjang ini sempat gagal dengan "permission denied to terminate process"** saat `DROP DATABASE ... WITH (FORCE)` di `src/testing/db.ts` — koneksi sisa dari run sebelumnya tidak bisa diterminasi oleh role non-superuser `aios_p8`. Hilang setelah `pg_ctlcluster 16 main restart`. Bukan bug kode; infrastruktur tes di VPS yang dipakai sangat intensif, bukan di VM CI yang segar tiap run.

### E. Verifikasi akhir (commit `5609247`, clone bersih)

| Pemeriksaan | Hasil |
| --- | --- |
| `pnpm build` / `pnpm typecheck` / `pnpm lint` | 7/7, 12/12, bersih |
| `pnpm test` sebagai pengguna biasa (Postgres nyata) | 655 lulus, 13 skip, 3 gagal (pre-existing, Chromium snap, lihat D) |
| `pnpm test` sebagai root (Postgres nyata) | 652 lulus, 13 skip, 6 gagal (Temuan D, lingkungan) |
| `pnpm --filter @aios/e2e e2e`, 3× berturut (`E2E_BROWSER=chrome`) | 39/39, 39/39, 38/39 (`team.spec` omp sungguhan, pre-existing P7) |
| `pnpm shots p8` + `pnpm shots:compare baseline-p0 p8` | 44 gambar + `_ringkasan.png` (6 layar berdampingan); 3,9–9,5% (ambang 24) akumulasi perubahan P1–P7, konsisten dengan progresi sesi-sesi sebelumnya |
| Android | tidak tersentuh sesi ini (lihat A) |
| CI (`check`/`gateway-image`/`e2e-desktop`) | sukses untuk `413d66e` dan `5609247` |

### Tidak diverifikasi

- Alur pengguna lengkap dengan Hermes/dsh **nyata** (bukan fixture): Hermes nyata hanya pernah direkam P5 (VPS terpisah, tidak tersedia di sini); dsh nyata tidak pernah tersedia di mesin pengembangan mana pun sejak P0 (binary tidak ada). Alur dicoba lewat e2e `[skenario:rencana]`/`[skenario:kaya]`/`[skenario:screenshot]` (Hermes palsu) dan `engine.spec.ts` (dsh palsu via `fake-dsh.mjs`) — semua lulus bersih di run e2e ke-2 (39/39).
- Tes instrumentasi Android, emulator, perangkat fisik (sama seperti P6 — tidak ada KVM di VPS ARM64 ini).


