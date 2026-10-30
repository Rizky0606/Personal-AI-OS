# Orca — Desain tim Lead + Worker

Status: **Implementasi gateway Lead-only tersedia; orkestrasi Lead→Worker belum diimplementasikan.** Keputusan implementasi memakai baseline konservatif pada `docs/superpowers/plans/2026-10-30-orca-team.md`; batas runtime, assignment/review, worktree tim, dan UI klien belum tersedia. Run tunggal tetap default; tim hanya dimulai eksplisit.

## Konteks dan batas

Orca menyediakan satu ruang kerja tim yang menggabungkan tugas paralel, status per anggota, aktivitas, serta persetujuan yang tidak membanjiri pengguna. Cindy menjadi contoh interaksi produk deklaratif; UI tetap memakai komponen native, kontrak ketat, tanpa HTML bebas. Repo sudah punya worktree per run, omp melalui adapter worker, event run yang tersimpan/di-replay, dan pg-boss bersama untuk antrean. Kontrak saat ini belum memiliki `subagent.updated` atau event tim. Karena percakapan adapter menandai `subagent.updated` sebagai belum ada, tim menjadi sumber event tim eksplisit; adapter tidak boleh mengarang progres subagen dari teks.

## Model data yang diusulkan

Semua status tahan restart di PostgreSQL. `pg-boss` menyimpan pekerjaan antrean; tabel domain menyimpan keadaan tim yang menjadi sumber kebenaran.

- **team**: `id`, `parentRunId` (run Lead yang sudah ada, unique), `projectId`, `status`, `prompt`, `plan`, `limits` (budget/token/time/steps), `cancelRequestedAt`, `createdAt`, `updatedAt`, `finishedAt`, `failureCode`. Satu team memiliki satu Lead dan sejumlah Worker; `parentRunId` menghubungkan event run yang sudah ada dan UI.
- **member**: `id`, `teamId`, `role` (`lead|worker`), `runId` unique, `status`, `task`, `acceptanceCriteria`, `worktreePath` dan `branch` (metadata, bukan akses path dari klien), `startedAt`, `finishedAt`, `exitReason`, `usage`. Setiap member coding memiliki run/worktree sendiri; Lead tidak mengedit worktree Worker.
- **assignment**: `id`, `teamId`, `workerMemberId`, `title`, `prompt`, `acceptanceCriteria`, `status`, `attempt`, `maxAttempts`, `resultSummary`, `resultRef` (commit SHA di branch sementara), `reviewStatus`, timestamps. Satu assignment aktif per Worker; dependency antartugas tidak didukung pada V1.
- **review**: `id`, `assignmentId`, `attempt`, `decision` (`accept|revise|reject`), `feedback`, `checks` JSON terstruktur (command/status/exit code), `commitSha`, timestamps. Constraint unik `(assignmentId, attempt)`; keputusan append-only.

Status team: `queued`, `planning`, `running`, `reviewing`, `completed`, `failed`, `cancelled`, `needs_attention`. Status member/assignment dipisahkan agar hasil Worker dapat ditinjau tanpa menganggap seluruh tim selesai. Event store per run tetap menyimpan activity; tabel team menyimpan agregat dan relasi. Setiap perubahan domain status dan enqueue berikutnya dilakukan transaksional/outbox-style agar tidak ada perubahan DB tanpa job yang dapat dipulihkan.

## Siklus hidup

1. Pemilik memilih mode tim secara eksplisit, mengirim tugas dan batas budget. Gateway membuat team + parent run + Lead member dalam satu transaksi, status `queued`, lalu enqueue `team.start`.
2. Lead memeriksa scope, membagi tugas independen yang dapat diuji, menetapkan kriteria selesai per assignment. Validasi menolak plan kosong, jumlah Worker di atas konfigurasi, tugas tanpa kriteria, duplikasi/ketergantungan implisit yang terdeteksi.
3. Gateway mengantrikan assignment. Worker hanya mulai setelah slot global tersedia dan membuat run/worktree sementara unik. Semua proses omp, perintah, PTY, dan Playwright memakai cwd worktree tersebut; project root tidak boleh dipakai sebagai cwd.
4. Worker mengirim hasil terstruktur: ringkasan, commit SHA, file/diff stat, hasil tes yang dijalankan, token/waktu/steps. Gateway simpan hasil, Lead menerima referensi/diff yang dibatasi.
5. Lead meninjau tiap hasil dan menjalankan cek yang ditentukan: `accept`, `revise` dengan feedback (maksimum `maxReviewRounds`), atau `reject`. Revisi tetap di worktree/branch Worker yang sama; setiap iterasi tercatat. Batas habis → `needs_attention`/reject sesuai keputusan terbuka.
6. Setelah semua assignment terminal, Lead menyusun ringkasan dan rekomendasi integrasi. Hasil tidak masuk ke branch project secara otomatis. Pemilik meninjau diff per anggota lalu memilih accept/integrasi manual atau reject; bila memilih integrasi gabungan, konflik menghentikan percobaan dan meminta keputusan manusia.
7. Terminal state menutup proses, terminal dan preview; Worker membersihkan worktree dan branch sementara hanya setelah commit hasil tersimpan. Retensi hasil commit mengikuti aturan keputusan di bawah.

## Konkurensi dan sumber daya VPS ARM 12 GB

Beban coding sebenarnya berjalan di worker Windows; VPS menanggung gateway, PostgreSQL, antrean, Lead bila Lead berada di VPS, dan metadata/event. Tanpa pengukuran VPS nyata, angka ini **batas konservatif awal**, bukan kapasitas terukur:

- Keputusan V1: maksimum satu agent aktif per tim sampai enforcement CPU/memori OS tersedia. Kapasitas dua Worker belum diaktifkan.
- Target awal **2 GiB RAM dan 1 CPU core per proses agent**; penegakan OS harus tersedia di mesin yang menjalankan proses. VPS tidak dapat menegakkan batas proses lokal di PC Windows. Sampai worker dapat menegakkan batas memori/CPU secara nyata, tim berjalan satu agent pada satu waktu; token dan timeout bukan pengganti batas OS.
- Reserve minimal **4 GiB RAM VPS** untuk OS/PostgreSQL/gateway/services; antrean dan timeout melindungi gateway, bukan menggantikan cgroup. Lead VPS memerlukan batas sendiri yang ditetapkan lewat konfigurasi yang sama.
- Angka durasi, langkah, token, input/output adalah target kebijakan; belum terbukti hard-enforced hingga runner menghentikan proses saat batas tercapai. Usage token best-effort bila adapter tidak melaporkannya.
- CPU/memori OS dan antrean durable lintas gateway process belum tersedia. Jangan menyatakan batas tersebut ditegakkan sebelum runtime dan uji integrasi membuktikannya.
- Batas jumlah prompt/output yang diusulkan: 20.000 token input dan 8.000 token output per panggilan agent. Anggaran melebihi batas harus menghentikan anggota; perilaku ini belum diimplementasikan.
## Isolasi, branch, dan pembersihan

- Worker mendapat worktree tersendiri di lokasi `.aios-worktrees` yang dikelola `WorktreeManager`, cabang sementara unik `aios/orca/<teamId>/<memberId>`, dibuat dari commit dasar yang sama.
- Proses agent, PTY, dev server dan Playwright wajib cwd worktree. Path project diselesaikan/diotorisasi worker; tidak ada jalur eksekusi command langsung dari gateway.
- Tidak berbagi working tree atau index git antarp pekerja. `node_modules` boleh ditautkan hanya melalui helper teruji dan wajib dilepas sebelum penghapusan.
- Saat selesai/cancel/crash: kirim cancel, tunggu grace period, terminate process group, tutup PTY/preview, lepaskan junction, simpan checkpoint/hasil jika valid, lalu hapus worktree. Jika proses mati sebelum ada commit hasil, hapus worktree/branch; bila cleanup gagal, tandai orphan dan retry saat worker start berikutnya. Jangan menghapus branch yang berisi hasil tersimpan sebelum keputusan pemilik.

## Penggabungan dan konflik

V1 tidak menggabungkan perubahan otomatis. Tiap Worker mengembalikan commit SHA dari branch terisolasi. Lead menilai hasil individual dan gateway menampilkan diff per anggota. Tidak ada push/merge ke branch aktif. Jika pemilik memilih integrasi gabungan, percobaan dilakukan di worktree terpisah, dibatalkan saat konflik, lalu team menjadi `needs_attention`. Pemilik memutuskan hasil diterima, penyelesaian konflik, atau penolakan. Lead boleh menyarankan, tidak boleh memutuskan merge final.

Keputusan terbuka: apakah V1 perlu worktree integrasi gabungan, atau cukup menampilkan diff per Worker dan membiarkan pemilik menggabungkan manual? Saran konservatif: diff per anggota; gabungan otomatis menambah konflik dan ownership.

## Budget dan penghentian paksa

Setiap team wajib membawa budget eksplisit. Default usulan tercantum di atas; tidak ada nilai tanpa batas atau fallback tak terbatas. Gateway mencatat usage yang dilaporkan adapter, timer member/team, dan batas langkah worker. Karena adapter omp tidak selalu memberi token setiap event, token cap bersifat best-effort sampai usage sumber dikonfirmasi; hard wall-clock dan step cap tetap wajib.

Cancel member menghentikan assignment itu; cancel Lead atau seluruh team menetapkan `cancelRequestedAt` secara atomik, membatalkan job tertunda, meneruskan cancel ke semua run aktif, menolak/membatalkan approval pending, lalu mengirim sinyal ke worker. Setelah grace period, worker terminate proses tree. Gateway restart tidak boleh menghidupkan ulang run aktif tanpa pemeriksaan; lihat pemulihan.

## Approval tanpa banjir

Persetujuan tetap per tindakan dan tidak pernah auto-allow hanya karena berasal dari Worker. Gateway mengagregasi pending approval menurut team: satu ringkasan dengan jumlah permintaan, anggota, jenis risiko, tujuan/path/perintah, waktu; daftar detail dapat dibuka satu per satu. Approval identik hanya dapat digabung untuk tampilan bila kind + detail + target + anggota sama dan satu keputusan akan diterapkan aman pada semua permintaan; selain itu masing-masing membutuhkan keputusan tersendiri. Tombol “izinkan semua” tidak ada di V1. Cancel anggota/team otomatis menolak approval anggota yang dibatalkan. UI tetap menampilkan jumlah pending dan urgensi tanpa menghilangkan konteks siapa yang meminta.

## Pembatalan dan kegagalan/pemulihan

- **Worker gagal/mati:** run terminal `failed`; simpan error/usage, tutup aktivitas terbuka, bersihkan worktree jika tidak ada commit valid. Lead dapat menerima tugas lain; gagal berulang hingga batas percobaan menandai team `needs_attention`.
- **Worker lambat:** per-member deadline membatalkan proses; setelah grace, kill process group. Slot baru dibuka setelah proses dipastikan mati atau dinyatakan orphan oleh worker.
- **Lead mati:** assignment yang sudah berjalan tetap tercatat; team menjadi `needs_attention` setelah heartbeat/lease habis. Tidak membuat Lead kedua otomatis pada V1. Pemilik dapat melanjutkan/restart Lead setelah inspeksi status.
- **Gateway restart:** Postgres dan pg-boss memulihkan antrean queued. Pada startup, status member/run `running` yang kehilangan lease ditandai `failed` dengan `gateway_restarted`; queued assignments tetap queued. Jangan menganggap adapter lokal masih hidup. Worker reconnect melaporkan run aktif; gateway hanya mengadopsi bila identitas team/member, lease dan status persisted cocok, selainnya minta cancel dan cleanup. Idempotency key mencegah menjalankan assignment yang sama dua kali.
- **Gateway-worker disconnect:** worker menyimpan event melalui outbox lokal sebagaimana pola run tunggal; reconnect mengirim ulang berurutan. Perintah cancel tetap persisted dan dikirim ulang saat reconnect.
- **DB/pg-boss tidak tersedia:** jangan mulai assignment baru. Tandai kesalahan operasional, pertahankan worktree lokal dan data yang bisa dipulihkan; jangan menghapus hasil yang belum terkonfirmasi tersimpan.
- **Merge conflict/check gagal:** tidak ada merge otomatis atau rollback ke project. Simpan evidence dan serahkan ke pemilik.

## Event dan tampilan

Kontrak V1 menambah event domain tambahan saja: `team.created`, `team.member.updated`, `team.review.completed`; schema member/review harus membawa ID stabil, status enum, timestamp, dan payload minimal tanpa prompt/secret/path sensitif. Mereka bisa menjadi stream tim tersimpan terpisah agar replay tidak bergantung pada run Lead. `subagent.updated` hanya ditambah bila dibutuhkan adapter untuk status subagent internal; event ini bukan pengganti member team dan tidak wajib untuk MVP.

Desktop menampilkan tab Aktivitas berupa pohon Lead → Worker, setiap anggota memakai Orb dan `buildActivity`; aksi stop anggota dan stop team. Approval ditampilkan sebagai agregat dengan detail expand. Android hanya-baca: ringkasan status per anggota. Setiap layar punya loading, empty, error, offline. Run tunggal tidak berubah dan tidak mendapatkan struktur team/event baru.

## Urutan teks

```text
Pemilik       Gateway/DB+pg-boss       Worker Lead       Worker A       Worker B       Pemilik
   |                  |                    |                |              |               |
   | start team + budget                  |                |              |               |
   |----------------->| persist team/run   |                |              |               |
   |                  | enqueue team.start |                |              |               |
   |                  |------------------->| plan + criteria|              |               |
   |                  |<-------------------| assignments    |              |               |
   |                  | enqueue A, B; slot global          |              |               |
   |                  |----------------------------------->| create worktree A             |
   |                  |----------------------------------------------->| create worktree B    |
   |                  |<-----------------------------------| result/commit|               |
   |                  |<----------------------------------------------| result/commit       |
   |                  |------------------->| run checks/review A,B      |               |
   |                  |<-------------------| accept/revise/reject       |               |
   |                  | enqueue revision(s) as needed                    |               |
   |                  |<-------------------| final recommendation      |               |
   |<-----------------| aggregate status, approvals, member tree         |               |
   | inspect diff / resolve conflicts / approve final integration       |               |
   |----------------->| persist decision; cleanup after retention policy  |               |
```

Cancellation:

```text
Pemilik -> Gateway: cancel Lead/team
Gateway -> DB: persist cancelRequestedAt; cancel queued assignments
Gateway -> Worker: cancel all active member runs (including pending approvals)
Worker -> process group/PTY/preview: graceful stop; timeout => force kill
Worker -> Gateway: terminal states + cleanup result
Gateway -> DB/UI: aggregate cancelled/failed; retain recoverable results
```

## Tidak dicakup V1

- DAG/dependency antarassignment, Worker membuat Worker lain, nesting tim, atau subagent omp asynchronous.
- Auto-merge/push ke branch project, cloud worktree, atau eksekusi kode di VPS.
- Kolaborasi beberapa pengguna, voting/approval quorum, dan auto-allow massal.
- Retry tanpa batas, budget tak terbatas, atau eksekusi tanpa worktree.
- Transfer tim ke mesin worker lain, autoscaling, migrasi worktree, atau resume agent setelah gateway restart.
- Jaminan enforcement memori/CPU lokal sebelum mekanisme OS worker terverifikasi; mode parallel tidak boleh mengklaim batas ini.
- Android untuk membuat/mengendalikan tim; hanya tampilan status baca-saja.
- Menjalankan browser preview/Playwright paralel tanpa kuota terpisah; preview berbagi sumber daya Worker dan dimatikan saat cancel.

## Keputusan terbuka untuk pemilik

1. Konfirmasi model satu Lead sebagai run omp di worker, atau Lead di VPS? Saran: Lead di worker agar seluruh coding tetap memakai adapter/project isolation yang ada.
2. Apakah Lead memerlukan worktree tersendiri (saran: ya; tidak pernah memakai project root), atau hanya mengatur assignment tanpa mengubah file?
3. Keputusan V1: satu agent aktif per tim sampai enforcement CPU/memori OS tersedia. Target resource 2 GiB RAM + 1 CPU per proses dan kapasitas global dua Worker perlu enforcement serta benchmark sebelum diaktifkan.
4. Slot global lintas gateway process memerlukan pg-boss concurrency/persistence; antrean tidak boleh meluncurkan agent di luar slot.
5. Apakah V1 menampilkan diff per Worker saja (saran konservatif), atau membangun worktree integrasi dan percobaan merge lokal?
6. Siapa memutuskan integrasi final dan retensi branch hasil: pemilik saja, Lead merekomendasikan? Berapa lama branch tersimpan setelah team selesai?
7. Saat Lead mati atau gateway restart: `needs_attention` dan intervensi pemilik (saran), atau boleh spawn ulang Lead dengan budget tersisa?
8. Persetujuan agregat: apakah satu keputusan boleh berlaku ke beberapa permintaan identik dari anggota berbeda? Saran: tidak; satu approval per aksi.
9. Apakah `team.*` disimpan pada stream baru, atau disimpan sebagai event di run Lead? Saran: stream team terpisah untuk ID/ownership/replay yang jelas.
10. Definisikan nilai budget wajib/default, siapa membayar token Lead vs Worker, serta perilaku ketika adapter tidak melaporkan usage lengkap.
11. Apakah scope implementasi lintas desktop dan Android tetap wajib untuk V1 walau Android hanya-baca, dan apakah tersedia uji perangkat/emulator?
12. E2E dua Worker perlu runner nyata atau fake adapters saja? Saran: tes perilaku orkestrator memakai fake adapters; satu e2e integrasi gateway-worker menggunakan dua fake Worker.
