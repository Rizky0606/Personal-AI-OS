# Performa

Tanggal pemeriksaan: 2026-10-30. Tidak ada hasil benchmark baru sesi ini. Jangan menganggap kinerja rilis terverifikasi.

| Skenario | Hasil sesi | Bukti/batasan |
| --- | --- | --- |
| Startup desktop | Tidak diukur | Tidak ada pengukuran waktu dingin/hangat. |
| 5.000 delta streaming | Tidak diukur | Tidak ada beban sintetis terukur. |
| Gulir 500 pesan | Tidak diukur | Tidak ada profiling UI/runtime. |
| Memori desktop satu jam | Tidak diukur | Tidak ada sesi observasi satu jam. |
| Waktu timer pertama | Tidak diukur | Tidak ada pengukuran Android/perangkat. |

Keamanan sumber ditinjau lewat `docs/SECURITY_OPS.md`, kontrol auth/log pada gateway, dan sandbox artifact; bukan audit runtime/penetrasi. Nilai ambang rilis belum ditetapkan dalam sumber kebenaran; jangan menciptakan hasil atau budget dari dugaan. Ukur pada mesin/perangkat rilis sebelum menetapkan baseline.