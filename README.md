# Personal AI OS — Paket Dokumen

Personal AI OS adalah dua aplikasi AI agent pribadi (Windows dan Android) yang memakai satu server di VPS Oracle. Mesin agent tidak ditulis ulang: Hermes, omp, dan 9Router dipasang di VPS dan Windows, lalu disambungkan lewat backend gateway dan adapter milik sendiri.

## Isi paket

| File | Isi |
| --- | --- |
| `AGENTS.md` | Aturan wajib untuk AI coding agent (taruh di root repo) |
| `docs/PRD.md` | Masalah, tujuan, fitur Windows dan Android, metrik |
| `docs/ARCHITECTURE.md` | Komponen, alur, adapter, lokasi eksekusi, struktur monorepo |
| `docs/VPS_SETUP.md` | Daftar instalasi VPS dan PC Windows, compose, nginx |
| `docs/DESIGN_SYSTEM.md` | Prinsip anti AI slop, token, tipografi, layout, komponen |
| `docs/ROLES_AND_SKILLS.md` | Role agent, format file role, skill, router otomatis |
| `docs/API_CONTRACT.md` | Endpoint REST, WebSocket, AgentEvent, model data |
| `docs/CODING_STANDARDS.md` | Tooling, gaya kode, testing, git |
| `docs/SECURITY_OPS.md` | Jaringan, token, worker, backup, observability |
| `docs/PROMPTS.md` | 25 prompt build berurutan beserta Preamble |
| `docs/ACCEPTANCE.md` | Checklist per tahap, risiko, hal yang belum terverifikasi |

## Cara memakai

1. Siapkan VPS sesuai `docs/VPS_SETUP.md`.
2. Jalankan Fase 0 di `docs/PROMPTS.md` untuk memverifikasi Hermes, omp, dan 9Router. Hasilnya `docs/VERIFICATION.md`.
3. Buat repo baru, salin `AGENTS.md` ke root dan semua file `docs/` ke folder `docs/`.
4. Jalankan prompt berikutnya satu per satu, berurutan. Setiap prompt diawali Preamble yang sama.
5. Setelah tiap tahap, cek `docs/ACCEPTANCE.md` sebelum lanjut.

Kalau melanjutkan repo AI-Agent yang sudah ada, jalankan Fase 1 dalam mode audit: petakan kode lama ke struktur baru dulu, jangan menimpa.
