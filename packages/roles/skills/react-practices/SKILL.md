---
name: react-practices
description: 'Praktik React 19: state minimal, efek seperlunya, komponen kecil, dan performa yang terukur.'
---

- Turunkan nilai saat render; jangan menyalin turunan ke state dan jangan memakai useEffect untuk sinkronisasi state.
- Efek hanya untuk sistem luar (jaringan, DOM, langganan), selalu dengan cleanup dan pembatalan request.
- State diletakkan serendah mungkin; data server lewat TanStack Query, bukan state manual.
- Komponen kecil dengan satu tanggung jawab; props bertipe eksplisit; tanpa any.
- Pakai primitif aksesibel dan komponen yang sudah ada; jangan menulis ulang perilaku fokus atau keyboard.
- Key daftar stabil (bukan indeks); daftar panjang divirtualisasi (mis. 1000 baris).
- Optimasi (memo, useMemo) hanya setelah diukur; sebutkan pengukurannya.
- Tes komponen mencakup state memuat, kosong, dan error.
