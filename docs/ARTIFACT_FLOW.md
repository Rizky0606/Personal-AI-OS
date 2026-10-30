# Alur artifact dan pratinjau

## Alur saat ini

### Berkas buatan agent (chat server/Hermes)

1. Gateway menyuntikkan instruksi folder `<OUTBOX_HOST_DIR>/<runId>/` ke prompt agent (`apps/gateway/src/modules/files/outbox.ts`).
2. Saat `run.completed`, runner chat memanggil `outbox.collect(runId)`; coding run tidak menjalankan koleksi ini (`apps/gateway/src/modules/runs/runner.ts`).
3. Collector membatasi 10 berkas, 25 MiB per berkas, 50 MiB total; hanya berkas biasa di bawah direktori run, symlink/path keluar dilewati.
4. `files.saveGenerated` membersihkan nama, menebak MIME dari ekstensi, menyimpan byte di tabel `files`; `MessagePart.file` kemudian disimpan pada jawaban assistant.
5. Klien memuat bagian `file` dari pesan akhir. Desktop `AssistantMessage.tsx` menampilkan daftar unduh; Android `ChatMessages.kt` menampilkan baris berkas dan pemilih lokasi simpan.
6. `GET /files/:id/download` memerlukan scope `app`, mengembalikan `attachment`, `nosniff`, `private, no-store`. Unduhan memakai akses terautentikasi klien yang sama.

### Screenshot preview worker

1. Worker memulai dev server dan browser Playwright per run (`apps/worker/src/preview/service.ts`). Tool MCP `browser_screenshot` mengembalikan tangkapan sebagai gambar inline/base64 ke agent; tidak menulisnya ke outbox atau DB files.
2. Jalur desktop `preview.shot` mengambil PNG dari worker, lalu mengembalikan base64 ke pemanggil lokal (`apps/worker/src/local/handlers.ts`). Ini untuk lampiran composer, bukan hasil artifact run, dan tidak mengirimnya ke gateway.
3. Gateway hanya menerima event run ter-normalisasi; saat ini `diff.updated`/`preview.ready` tersedia. Tidak ada `artifact.created`, penyimpanan screenshot worker ke `/files`, atau referensi artifact pada run.

## Yang belum tersambung

- Berkas outbox disimpan dan muncul sebagai `MessagePart.file` hanya setelah run selesai; tidak ada pemberitahuan realtime saat file ditemukan.
- Screenshot Playwright tidak disimpan bersama file run. Screenshot `preview.shot` hanya dikirim ke desktop lokal.
- Berkas file tidak mempunyai relasi run/owner tersendiri di tabel `files`; pada instalasi satu pemilik, unduhan dibatasi scope `app` dan autentikasi perangkat pemilik, tetapi ID tidak diberi otorisasi per-file selain itu.
- Belum ada strip thumbnail atau preview file pada UI chat/aktivitas. Attachment buatan agent hanya punya tombol unduh.
- Gateway tidak memiliki pembuat thumbnail saat ini. Gambar asli dapat dimuat melalui endpoint download berautentikasi, dengan lazy-loading dan batas ukuran tampilan. Server-side thumbnail memerlukan pustaka baru; kandidat untuk persetujuan backlog: `sharp`.
- `image/svg+xml` saat ini dikenali sebagai MIME dari ekstensi untuk file buatan agent, tetapi endpoint selalu mengirimnya sebagai attachment. SVG tidak boleh masuk jalur render inline.

## Usulan sambungan sesi ini

Gunakan kontrak `artifact.created` untuk file run yang sudah tervalidasi dan tersimpan; event membawa metadata saja, bukan byte. Server menyimpan output lewat `files.saveGenerated`, mengaitkan ID run saat memancarkan event, lalu UI menarik isi dari `GET /files/:id/download` dengan auth yang ada. PNG screenshot dari jalur Playwright/outbox dan file lain mengikuti batas yang sama; SVG dan MIME tak dikenal tampil sebagai berkas. Aktivitas menyimpan metadata artifact realtime untuk thumbnail; pesan final tetap memakai `MessagePart.file` agar riwayat/unduh kompatibel. Tidak ada salinan permanen di klien.
