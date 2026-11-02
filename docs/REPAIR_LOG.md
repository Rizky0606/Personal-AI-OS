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
