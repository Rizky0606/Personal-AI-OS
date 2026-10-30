# Tinjauan keamanan — persiapan rilis 2026-10-30

Tinjauan source/dokumen, bukan audit penetrasi. Tidak ada akses produksi digunakan.

## Kontrol yang ditemukan

- Gateway mewajibkan bearer token dan scope (`apps/gateway/src/modules/auth/guard.ts`). Tes gateway menguji header redaction (`apps/gateway/src/app.test.ts`); `apps/gateway/src/app.ts` menetapkan jalur redaksi header.
- API key provider dibaca konfigurasi gateway (`apps/gateway/src/config.ts`, `apps/gateway/src/main.ts`), bukan klien menurut arsitektur. `docs/SECURITY_OPS.md` melarang log token/.env/header Authorization.
- Artifact dipisahkan origin/iframe sandbox pada desktop dan WebView terbatas Android; unduhan file terautentikasi dan attachment (`docs/SECURITY_OPS.md`).
- `apps/gateway/src/modules/dsh/launch.ts` menyaring environment proses dsh dan menggunakan `spec.cwd`; tes menguji tidak bocornya `DATABASE_URL`, `AUTH_SECRET`, dan `HERMES_API_KEY`.
- DSH nyata hanya boleh dijalankan sandbox dan belum direkam; `dsh` binary tidak ditemukan pada PATH sesi ini. Tidak ada verifikasi sandbox VPS aktual.

## Batas verifikasi

- Tidak menjalankan penetration test, deployment, atau pemeriksaan konfigurasi VPS aktual.
- Tidak memeriksa seluruh rute/seluruh jalur worker secara dinamis. Sumber aturan operasional: `docs/SECURITY_OPS.md`; tes security terintegrasi tetap perlu dijalankan pada verifikasi final.
- Referensi `docs/SECURITY_AUDIT.md` di `docs/SECURITY_OPS.md` adalah audit terdahulu, bukan bukti audit baru sesi ini.
