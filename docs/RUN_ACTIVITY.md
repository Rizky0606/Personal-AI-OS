# Lapisan data aktivitas run (Sesi 3)

Mengubah aliran event run menjadi data untuk baris progres ala Claude: satu judul abu ringkas, satu baris aksi saat ini dalam kalimat manusiawi, penghitung waktu, jumlah langkah (+N), dan ringkasan setelah selesai. Sejak P2 baris ini tampil di dalam jawaban (lihat "Tampilan di chat (P2)").

## Alur

`EventEnvelope` (WebSocket/replay) → `reduceLiveRun(run, event, ts)` → `LiveRun` → `buildActivity(live, now)` → `Activity`.

- `apps/desktop/src/realtime/liveRun.ts`: reducer murni. Sesi 3 menambah ke `LiveRun`: `startedAt`, `endedAt`, `lastEventAt` (ms epoch dari `envelope.ts`), `lastActivity`, `reasoningSummary`, dan `ToolStep.startedAt`. `tool.finished` yang tiba sebelum `tool.started` tidak hilang (langkah bernama kosong, dilengkapi saat started datang); event yang diputar ulang tidak memindahkan posisi atau waktu mulai.
- `apps/desktop/src/realtime/activity.ts`: `buildActivity`, `formatElapsed`, `truncateTarget`. Tanpa React dan tanpa `Date.now`; "sekarang" dari pemanggil.
- `apps/desktop/src/copy.ts` (`runActivity`): kalimat berjalan, selesai, dan kata benda per jenis tool, kalimat umum untuk tool tak dikenal, satuan waktu.
- `RunTracker` meneruskan `Date.parse(envelope.ts)` dan, saat polling, mengisi `startedAt` dari `Run.createdAt` serta `endedAt` dari `Run.updatedAt` bila run sudah selesai tetapi event penutup tidak sampai.

## Kontrak

- Event baru **opsional** `reasoning.summary {messageId, text}`: judul satu baris dari penalaran; pembaruan menggantikan judul. **Tidak ada mesin yang mengirimnya** (`docs/ADAPTER_EVENTS.md`); adapter tidak mengarang. Judul diturunkan di klien dari teks penalaran.
- **`startedAt` tidak ditambahkan ke `run.status`.** Entitas `Run` sudah membawa `createdAt` (waktu run dibuat = waktu pengguna mengirim pesan) dan setiap event membawa `ts` di envelope/`RunEvent`. Itu cukup untuk waktu mulai, termasuk setelah reload.

## Aturan `buildActivity`

| Bidang | Aturan |
| --- | --- |
| `headline` | `reasoningSummary` bila tidak kosong; selain itu kalimat pertama teks penalaran (baris bermakna pertama, markdown dibuang, titik akhir dibuang), maks 80 karakter (`…` bila dipotong); `null` bila tak ada. |
| `phase` | Terminal: `done` (completed, needs_review, accepted, rejected), `error` (failed), `cancelled`. Selain itu: `waiting_approval` (status atau izin tertunda) › `tool` (ada tool berjalan) › `writing` (aktivitas terakhir teks) › `thinking` (aktivitas lain, atau status running tanpa aktivitas) › `idle` (queued/routing/preparing tanpa aktivitas). Aktivitas mengalahkan status `queued` agar reload tanpa event `run.status` tetap benar. |
| `current` | Tool berjalan yang paling baru dimulai: `{label, target?, parallel}`; `parallel` = jumlah tool berjalan. `null` bila tak ada. |
| `steps` | Urutan pertama terlihat. `label` menurut status: berjalan, selesai, atau "<kata benda> gagal/ditolak/dibatalkan". `durationMs`: dari mesin bila selesai; sejak mulai bila berjalan (`null` bila waktu mulai tak diketahui). |
| `stepCount`, `hiddenCount` | `hiddenCount = max(0, stepCount − visibleSteps)`; `visibleSteps` bawaan 3 (opsi). |
| `elapsedMs` | `end − startedAt`, tidak pernah negatif; `end` = `endedAt` bila ada, selain itu `now` (berjalan) atau `lastEventAt` (selesai tanpa `endedAt`). 0 bila `startedAt` tak diketahui. Berhenti pada `run.completed`, `error`, atau status selesai pertama (termasuk `needs_review`). |
| `summary` | Hanya saat terminal: `"<Selesai\|Gagal\|Dibatalkan> · <waktu> · <N langkah>"` (bagian langkah dibuang bila 0). |
| `needsAttention` | Ada tool `error`, atau (belum selesai) menunggu persetujuan. Tool `denied`/`cancelled` tidak. |

Target (`truncateTarget`): satu baris, spasi dipadatkan, maks 60 karakter. Path memotong awal (nama berkas tetap terlihat), perintah dan URL memotong akhir.

Pemetaan nama tool → jenis ada di `TOOL_KINDS` (`activity.ts`): terverifikasi rekaman untuk omp `bash`, `write`, `todo`, `task`; sisanya dari daftar tool omp dan nama umum Hermes (belum terverifikasi rekaman Hermes). Awalan `browser_` → membuka halaman. Nama lain (termasuk `mcp__…`) → "Menjalankan alat: <nama>".

`formatElapsed`: detik dipotong ke bawah (floor). `< 60 dtk`: `N dtk`; `< 1 jam`: `M mnt SS dtk`; `≥ 1 jam`: `J j MM mnt` (detik dibuang). Negatif atau bukan angka → `0 dtk`.

## Fixture emas

`packages/contracts/fixtures/activity/*.json`: `{name, description, runId, runCreatedAt?, visibleSteps, events[{seq, ts, event}], checkpoints[{note, applied, now, activity}]}`. Memutar `applied` event pertama lalu memanggil `buildActivity(live, now)` harus sama persis dengan `activity`. `format-elapsed.json`: pasangan `ms` → teks. Skenario: `short-no-tools`, `fourteen-tools`, `parallel-tools`, `tool-error-mid`, `waiting-approval`, `cancelled`, `hermes-no-reasoning`, `reload-mid-run` (tanpa event awal; waktu mulai dari `runCreatedAt`), `out-of-order-tool`. Dibaca oleh `activityFixtures.test.ts` (desktop) dan divalidasi bentuknya oleh `activity-fixtures.test.ts` (contracts). Android memakai berkas yang sama di sesi 8.

Fixture dibuat dengan menjalankan implementasi lalu memeriksa tiap keluaran secara manual (fase, label, durasi, ringkasan, waktu berhenti); ubah hanya dengan sengaja.

## Asumsi yang perlu dikonfirmasi

- Pemisah ringkasan `" · "` (contoh di permintaan tertulis dengan spasi ganda).
- `visibleSteps` = 3 dan `hiddenCount` dihitung dari jendela itu (UI "+N lain" bisa memakai `stepCount − 1`).
- `rejected` (review ditolak) dianggap `done`, bukan `cancelled`.

## Tampilan di chat (P2)

`AssistantMessage` memuat `RunActivity` di antara baris meta dan isi jawaban, selebar kolom baca (`--aios-chat-measure`). Urutan seperti Claude:

1. **Judul** abu (`headline`; tidak tampil bila null) dengan kilau (`.aios-headline-shimmer`) selama berjalan. Satu-satunya elemen `aria-live="polite"`; baris dan timer tidak diumumkan.
2. **Baris terlipat** (tombol; Enter/Spasi membuka): aksi saat ini + target redup + timer + `+N` (langkah sebelum yang sekarang) + chevron. Fase `waiting_approval` menampilkan "Menunggu izin" (target tetap redup), bukan aksi tool-nya. Setelah selesai berisi ringkasan "Selesai · durasi · N langkah".
3. **Linimasa** (saat dibuka): satu baris per langkah (ikon status, kalimat langkah, target, durasi), output terakhir, pratinjau artifact, dan jalan pintas ke panel izin. Terbuka sendiri bila `needsAttention` (tool galat atau izin menunggu); pengguna tetap bisa menutupnya. Deretan chip tool tidak lagi tampil di luar linimasa.
4. **Avatar** adalah `AgentOrb` 28 px: fase dari `buildActivity` untuk jawaban berjalan; jawaban lama `done`, atau `error` bila run gagal.

Sumber data per jawaban (`MessageList`): run berjalan dari `buildActivity(live, now)`; run yang baru selesai di sesi ini dari jejak `finished` (waktu nyata, selalu punya baris); jawaban lama dari `savedActivity(tools, run)` (`realtime/activity.ts`) memakai bagian `tool` yang tersimpan dan `Run` dari `getRun` (hanya diambil bila jawaban punya langkah tool; jawaban teks biasa tidak diberi baris). **Durasi jawaban lama hanya dihitung** bila status run `completed`/`failed`/`cancelled` (`updatedAt − createdAt`); `needs_review`/`accepted`/`rejected` berubah saat peninjauan, jadi hanya jumlah langkah yang ditampilkan. Tanpa data run, juga hanya jumlah langkah; durasi tidak dikarang.

Skenario e2e (`e2e/harness/fakes.ts`, hanya di stack e2e): `[skenario:tool]` dan `[skenario:error]` membuat Hermes palsu mengirim 2 kalimat penalaran, 5 tool (400–900 ms, satu output per tool) lewat event SSE `hermes.tool.progress`, lalu jawaban; pada `[skenario:error]` tool ke-3 gagal. `[skenario:izin]` di dalam project memakai skrip omp yang meminta izin menulis berkas dan berhenti di `approval.requested`.

## Panel Progres (P2B)

Tab pertama panel kanan (`progress`), plus chip "Langkah N dari M" di Topbar layar chat (klik atau `Ctrl+.` membuka tab). Data dari `buildProgress(response, live, now)` (`realtime/progress.ts`, murni, fixture emas `packages/contracts/fixtures/progress/`, dipakai Android di P6).

**Sumber data.**
- Tersimpan: `GET /conversations/:id/progress` (`plan`, `outputs`, `used`), dibangun gateway dari event run tersimpan (`apps/gateway/src/modules/chat/progress.ts`, tanpa tabel baru). Diambil ulang tiap run selesai.
- Live: `todo.updated`, `artifact.created`, `context.used`, `tool.started` dari run yang mengalir; digabung tanpa duplikasi (rencana live menggantikan yang tersimpan; artifact dengan `fileId` sama tidak ganda; skill, lampiran, dan alat digabung sebagai himpunan; engine, model, dan memori mengikuti run terbaru).
- `context.used` dikirim gateway saat run mulai, setelah router memilih role dan skill dan setelah memori dibaca, lalu dikirim lagi (isi sama, `openedSkills` bertambah) setiap ada skill katalog yang terbukti dibuka agent; klien menggabungkannya sebagai himpunan. Isinya skill, memori (jumlah dan judul singkat: 40 karakter pertama teks fakta, bukan isi lengkap), nama lampiran, engine, model. Alat tidak ada di event ini; klien menghitungnya dari `tool.started`.

**Chip.** "Langkah N dari M": N = langkah `in_progress` (atau yang terhambat, atau langkah pending pertama di sela pembaruan; semua selesai = M dari M). Mesin tanpa tool `todo` (Hermes): langkah diturunkan dari langkah tool (`buildActivity`), chip "Langkah N" tanpa total (total tidak pernah dikarang). Nama aksesibel: "Langkah 7 dari 9: <langkah>". Angka bergulir 180 ms. Hanya muncul bila ada langkah.

**Isi panel.** (1) Progres: `<ol>` dengan titik per langkah; selesai lebih dari dua diringkas "N langkah sebelumnya" (tombol aria-expanded); dua selesai terakhir redup; aktif berpendar dengan warna fase; terhambat memuat ikon dan alasan; nama tahap hanya bila ada lebih dari satu tahap; status selalu ada di teks. (2) Output: kartu dua kolom (Gambar membuka lightbox, Berkas diunduh, Perubahan kode membuka tab Diff untuk run itu, Laporan riset membuka layar riset). (3) Digunakan dalam sesi ini: Unggahan, Skill, Memori ("Dibaca · N fakta", klik membuka judul), Mesin dan model, Alat (Web, Browser, Terminal, Berkas, Subagent), Konektor MCP hanya bila ada datanya. Empat state: memuat, kosong, error (Coba lagi), isi; offline menampilkan data terakhir dengan tanda.

**Skill `plan-progress`** (agent project/omp): wajib membuat rencana dengan tool `todo` untuk tugas 3 langkah atau lebih (3 sampai 12 langkah, langkah terakhir "Periksa hasil", tepat satu `in_progress`, diperbarui tiap langkah selesai). Rencana tidak lagi tampil di AgentHud; HUD hanya antrean arahan dan subagent.

**Skenario e2e `[skenario:rencana]`** (`e2e/harness/fakes.ts`): Hermes palsu tidak punya rencana, artifact, dan diff, jadi fake menyisipkan event itu ke event store gateway untuk run yang sedang berjalan (`AuthEnv.activeRunId`): `context.used`, `todo.updated` 9 langkah yang maju tiap 600 ms, dua `artifact.created` (berkas nyata di gateway), dan `diff.updated`. Event tersimpan dan sampai ke klien lewat WebSocket sungguhan, jadi muat ulang menguji agregat.
