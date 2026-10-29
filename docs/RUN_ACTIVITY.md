# Lapisan data aktivitas run (Sesi 3)

Mengubah aliran event run menjadi data untuk baris progres ala Claude: satu judul abu ringkas, satu baris aksi saat ini dalam kalimat manusiawi, penghitung waktu, jumlah langkah (+N), dan ringkasan setelah selesai. Belum ada komponen UI; `AssistantMessage` tidak diubah.

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
