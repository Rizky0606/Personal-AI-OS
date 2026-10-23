---
name: ui-states
description: Setiap layar punya state memuat, kosong, error, dan offline, serta tahan data ekstrem.
---

- Memuat: skeleton sesuai bentuk konten; bukan spinner di layar kosong.
- Kosong: satu kalimat apa yang bisa dilakukan, plus satu tombol aksi.
- Error: sebutkan apa yang gagal dan langkah berikutnya; sediakan coba lagi dan simpan input pengguna.
- Offline: tampilkan data tersimpan bila ada, tandai usianya, dan tahan aksi yang butuh jaringan.
- Uji dengan data ekstrem: teks sangat panjang atau kosong, daftar sangat besar, angka besar, karakter khusus.
- Cegah kirim ganda; batalkan update optimistis bila gagal; bersihkan listener dan timer saat unmount.
- Pastikan teks tidak meluap: pakai wrap atau potong, tanpa lebar tetap untuk teks.
- Laporkan state mana yang benar-benar diuji.
