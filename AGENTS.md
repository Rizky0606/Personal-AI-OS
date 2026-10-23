# AGENTS.md — Personal AI OS

## Sumber kebenaran
Baca sebelum bekerja, sesuai tugas:
- docs/PRD.md — apa yang dibangun dan tidak dibangun
- docs/ARCHITECTURE.md — komponen, alur, lokasi eksekusi
- docs/API_CONTRACT.md — endpoint, event, model data
- docs/DESIGN_SYSTEM.md — wajib untuk semua pekerjaan UI
- docs/ROLES_AND_SKILLS.md — role, skill, router
- docs/CODING_STANDARDS.md — gaya kode dan testing
- docs/SECURITY_OPS.md — aturan keamanan
- docs/VERIFICATION.md — hasil verifikasi Hermes, omp, 9Router (Fase 0)
Jika dokumen dan kode bertentangan, berhenti dan laporkan. Jangan menebak.

## Cara kerja
1. Kerjakan hanya scope prompt saat ini. Catat ide di luar scope di docs/BACKLOG.md.
2. Tulis rencana singkat (file yang disentuh, langkah, cara verifikasi) sebelum mengubah kode.
3. Ubah sesedikit mungkin. Tanpa refactor, rename, atau format ulang yang tidak diminta.
4. Tanpa dependensi baru kecuali disebut di prompt atau dokumen; jika perlu, jelaskan alasannya.
5. Selesai berarti: typecheck, lint, dan tes lulus, plus langkah verifikasi manual tertulis.
6. Akhiri dengan ringkasan: apa yang berubah, file, cara uji, sisa pekerjaan.

## Batas yang tidak boleh dilanggar
- Kontrak API dan event hanya diubah di packages/contracts, lalu semua pemakai diperbarui di tugas yang sama.
- Mesin agent (Hermes, omp, Pi) hanya dipanggil lewat packages/adapters.
- Tidak ada API key model di klien. Semua panggilan model lewat gateway atau 9Router.
- Worker tidak boleh menulis di luar worktree run dan folder yang diizinkan.
- Port Hermes, 9Router, Postgres, SearXNG tidak pernah diekspos publik.
- Rahasia tidak pernah di-commit. Gunakan .env (diabaikan git) dan contoh di .env.example.
- Jangan menonaktifkan tes, lint, atau typecheck untuk membuat build lulus.

## UI
- Hanya token dari packages/ui-tokens. Tidak ada warna hex atau ukuran acak di komponen.
- Patuhi daftar larangan anti AI slop di DESIGN_SYSTEM.md.
- Setiap layar wajib punya state memuat, kosong, error, dan offline.
- Aksesibilitas: label, fokus terlihat, navigasi keyboard, kontras AA.

## Git
- Branch: feat/<fase>-<ringkas>, fix/<ringkas>.
- Conventional Commits: feat:, fix:, refactor:, test:, docs:, chore:.
- Satu prompt = satu atau beberapa commit kecil yang masing-masing bisa di-build.

## Saat ragu
Ajukan maksimal satu pertanyaan, atau pilih opsi paling sederhana yang sesuai dokumen dan tulis asumsinya di ringkasan.
