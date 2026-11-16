/**
 * Set evaluasi recall memori (docs/DESIGN_MEMORI_SEMANTIK.md bagian 5): fakta sintetis, bukan data pemilik.
 * Fakta disimpan terlama dulu sesuai urutan di sini (yang terakhir = paling baru diubah). `relevant` berisi kunci
 * fakta yang seharusnya ikut ke pesan sistem; kosong = kueri negatif (tidak ada memori yang relevan).
 */
export interface MemoryEvalFact {
  key: string;
  text: string;
  pinned?: boolean;
}

export type MemoryEvalCategory = 'kata' | 'parafrase' | 'lintas-bahasa' | 'susulan' | 'negatif';

export interface MemoryEvalQuery {
  category: MemoryEvalCategory;
  /** Pesan pemilik ini. */
  text: string;
  /** Pesan pemilik sebelumnya di percakapan yang sama (kategori `susulan`). */
  previous?: string;
  relevant: readonly string[];
}

export const MEMORY_EVAL_FACTS: readonly MemoryEvalFact[] = [
  { key: 'nama', text: 'Nama saya Rina Kartika.', pinned: true },
  {
    key: 'bahasa',
    text: 'Jawab dalam bahasa Indonesia yang santai kecuali saya menulis dalam bahasa Inggris.',
    pinned: true,
  },
  { key: 'zona', text: 'Zona waktu saya WIB (Asia/Jakarta).', pinned: true },
  { key: 'kota', text: 'Saya tinggal di Bandung, dekat Dago.' },
  { key: 'kantor', text: 'Kantor saya di Jakarta Selatan, kerja hybrid Selasa sampai Kamis.' },
  { key: 'pekerjaan', text: 'Saya bekerja sebagai backend engineer di perusahaan logistik.' },
  { key: 'stack', text: 'Stack utama saya TypeScript, Node.js, dan PostgreSQL.' },
  { key: 'editor', text: 'Editor kode saya VS Code dengan tema gelap.' },
  { key: 'os', text: 'Laptop kerja saya MacBook Pro M3; di rumah memakai Windows 11.' },
  { key: 'server', text: 'Server pribadi saya VPS ARM64 Ubuntu 24.04 di Singapura.' },
  { key: 'docker', text: 'Deploy aplikasi pribadi memakai Docker Compose, bukan Kubernetes.' },
  { key: 'git', text: 'Pesan commit saya pakai Conventional Commits dalam bahasa Indonesia.' },
  { key: 'tes', text: 'Saya lebih suka Vitest daripada Jest untuk proyek baru.' },
  { key: 'kopi', text: 'Saya minum kopi hitam tanpa gula, maksimal dua gelas sehari.' },
  { key: 'alergi', text: 'Saya alergi udang dan kepiting.' },
  { key: 'daging', text: 'Saya tidak makan daging sapi.' },
  { key: 'olahraga', text: 'Saya lari pagi tiga kali seminggu, biasanya 5 km.' },
  { key: 'sepeda', text: 'Akhir pekan saya bersepeda ke Lembang.' },
  { key: 'anak', text: 'Anak saya bernama Dimas, kelas 3 SD.' },
  { key: 'pasangan', text: 'Istri saya Sari bekerja sebagai dokter gigi.' },
  { key: 'kucing', text: 'Kami memelihara dua kucing bernama Mochi dan Kopi.' },
  { key: 'mobil', text: 'Mobil keluarga kami Toyota Avanza 2019.' },
  { key: 'berangkat', text: 'Ke kantor saya naik KRL lalu ojek online.' },
  { key: 'bank', text: 'Rekening utama di BCA; tabungan darurat di Bank Jago.' },
  { key: 'anggaran', text: 'Anggaran belanja bulanan rumah tangga sekitar 8 juta rupiah.' },
  { key: 'investasi', text: 'Investasi saya reksa dana indeks dan sedikit emas.' },
  { key: 'asuransi', text: 'Asuransi kesehatan keluarga lewat BPJS dan asuransi kantor.' },
  { key: 'buku', text: 'Saya suka membaca buku sejarah dan biografi.' },
  { key: 'film', text: 'Film favorit saya Interstellar; tidak suka film horor.' },
  { key: 'musik', text: 'Saat fokus kerja saya mendengarkan musik lo-fi.' },
  { key: 'jepang', text: 'Saya sedang belajar bahasa Jepang level N4.' },
  { key: 'liburan', text: 'Rencana liburan akhir tahun ke Yogyakarta bersama keluarga.' },
  { key: 'ultah', text: 'Ulang tahun saya 14 Februari.' },
  { key: 'ultah-anak', text: 'Ulang tahun Dimas 3 Juli.' },
  { key: 'gaya', text: 'Saya suka jawaban singkat dengan poin-poin, tanpa basa-basi.' },
  {
    key: 'komentar',
    text: 'Komentar kode boleh dalam bahasa Indonesia, nama variabel tetap bahasa Inggris.',
  },
  { key: 'tanggal', text: 'Tulis tanggal dengan format 16 November 2026, bukan 11/16/2026.' },
  { key: 'rupiah', text: 'Tulis angka uang dalam rupiah dengan titik pemisah ribuan.' },
  { key: 'rapat', text: 'Rapat tim mingguan setiap Senin jam 10 pagi.' },
  { key: 'jam-kerja', text: 'Saya tidak mau diganggu notifikasi kerja setelah jam 9 malam.' },
  { key: 'tidur', text: 'Biasanya saya tidur jam 11 malam dan bangun jam 5 pagi.' },
  { key: 'mata', text: 'Saya punya mata minus 2,5 dan memakai kacamata.' },
  { key: 'dokter', text: 'Dokter keluarga kami dr. Hendra di Klinik Sehat Dago.' },
  { key: 'rumah', text: 'Rumah kami dua lantai dengan taman kecil di belakang.' },
  { key: 'tanaman', text: 'Saya menanam cabai dan tomat di pot.' },
  { key: 'internet', text: 'Internet rumah memakai IndiHome 100 Mbps.' },
  { key: 'ponsel', text: 'Ponsel saya Pixel 8 dengan Android 15.' },
  { key: 'rust', text: 'I want to learn Rust this year.' },
  { key: 'singapore', text: 'I usually travel to Singapore for work twice a year.' },
  { key: 'gula', text: 'I prefer low-sugar meals.' },
  { key: 'podcast', text: 'My favorite podcast is Lex Fridman.' },
  { key: 'frontend', text: 'Frontend favorit saya React dengan Tailwind.' },
  { key: 'antrean', text: 'Untuk antrean pekerjaan saya pakai pg-boss di PostgreSQL.' },
  { key: 'log', text: 'Log produksi saya kirim ke Grafana Loki.' },
  { key: 'rahasia', text: 'Jangan pernah menyimpan kunci API di repo; pakai berkas env.' },
  { key: 'dokumen', text: 'Dokumentasi proyek ditulis dalam bahasa Indonesia.' },
  { key: 'klien', text: 'Klien utama freelance saya toko kue online di Surabaya.' },
  { key: 'tarif', text: 'Tarif freelance saya 350 ribu per jam.' },
  { key: 'orang-tua', text: 'Orang tua saya tinggal di Malang.' },
  { key: 'mudik', text: 'Setiap Lebaran kami mudik ke Malang naik kereta.' },
];

export const MEMORY_EVAL_QUERIES: readonly MemoryEvalQuery[] = [
  { category: 'kata', text: 'Kapan rapat tim mingguan?', relevant: ['rapat'] },
  {
    category: 'kata',
    text: 'Rekomendasikan rute bersepeda dekat Lembang',
    relevant: ['sepeda'],
  },
  { category: 'kata', text: 'Buatkan resep makan malam tanpa udang ya', relevant: ['alergi'] },
  {
    category: 'kata',
    text: 'Berapa tarif freelance yang wajar untuk dinaikkan?',
    relevant: ['tarif'],
  },
  { category: 'kata', text: 'Setup Docker Compose untuk Postgres', relevant: ['docker'] },
  { category: 'kata', text: 'Tulis pesan commit untuk perubahan ini', relevant: ['git'] },
  { category: 'kata', text: 'Ide kado ulang tahun Dimas', relevant: ['ultah-anak', 'anak'] },
  { category: 'kata', text: 'Pilih reksa dana yang cocok', relevant: ['investasi'] },
  { category: 'kata', text: 'Kucing Mochi muntah, harus bagaimana?', relevant: ['kucing'] },
  {
    category: 'kata',
    text: 'Rencana liburan ke Yogyakarta, ada saran tempat?',
    relevant: ['liburan'],
  },
  { category: 'kata', text: 'Konfigurasi Grafana Loki untuk log', relevant: ['log'] },
  {
    category: 'kata',
    text: 'Daun tanaman cabai keriting, kenapa?',
    relevant: ['tanaman'],
  },
  { category: 'kata', text: 'Belajar bahasa Jepang N4 dari mana?', relevant: ['jepang'] },
  {
    category: 'kata',
    text: 'Jadwal kereta mudik Lebaran ke Malang',
    relevant: ['mudik', 'orang-tua'],
  },

  {
    category: 'parafrase',
    text: 'Apa yang aman dipesan di restoran seafood?',
    relevant: ['alergi'],
  },
  {
    category: 'parafrase',
    text: 'Kapan sebaiknya mengirim pesan soal pekerjaan ke saya?',
    relevant: ['jam-kerja'],
  },
  {
    category: 'parafrase',
    text: 'Ide hadiah untuk pendamping hidup saya',
    relevant: ['pasangan'],
  },
  { category: 'parafrase', text: 'Kendaraan apa yang kami punya?', relevant: ['mobil'] },
  {
    category: 'parafrase',
    text: 'Bagaimana saya biasanya berangkat ke tempat kerja?',
    relevant: ['berangkat'],
  },
  { category: 'parafrase', text: 'Kapan biasanya saya istirahat?', relevant: ['tidur'] },
  {
    category: 'parafrase',
    text: 'Minuman apa yang saya suka sebelum mulai bekerja?',
    relevant: ['kopi'],
  },
  {
    category: 'parafrase',
    text: 'Hewan peliharaan apa yang ada di rumah?',
    relevant: ['kucing'],
  },

  { category: 'lintas-bahasa', text: 'What city do I live in?', relevant: ['kota'] },
  { category: 'lintas-bahasa', text: 'Which code editor do I use?', relevant: ['editor'] },
  {
    category: 'lintas-bahasa',
    text: 'Saya mau belajar bahasa pemrograman baru tahun ini',
    relevant: ['rust'],
  },
  {
    category: 'lintas-bahasa',
    text: 'Seberapa sering saya dinas ke Singapura?',
    relevant: ['singapore'],
  },
  {
    category: 'lintas-bahasa',
    text: 'Menu makan siang rendah gula',
    relevant: ['gula'],
  },
  { category: 'lintas-bahasa', text: 'What is my favorite movie?', relevant: ['film'] },

  {
    category: 'susulan',
    text: 'yang itu saja, tapi lebih pendek',
    previous: 'Buat rencana lari pagi minggu ini',
    relevant: ['olahraga'],
  },
  {
    category: 'susulan',
    text: 'lanjutkan',
    previous: 'Bandingkan asuransi kesehatan untuk keluarga',
    relevant: ['asuransi'],
  },
  {
    category: 'susulan',
    text: 'ok, versi rupiah',
    previous: 'Hitung anggaran belanja bulanan rumah tangga',
    relevant: ['anggaran', 'rupiah'],
  },
  {
    category: 'susulan',
    text: 'tambahkan contohnya',
    previous: 'Cara menulis komentar kode yang baik',
    relevant: ['komentar'],
  },
  {
    category: 'susulan',
    text: 'yang kedua',
    previous: 'Pilihan ponsel pengganti Pixel',
    relevant: ['ponsel'],
  },
  {
    category: 'susulan',
    text: 'lebih detail',
    previous: 'Cara deploy Docker Compose di VPS ARM64',
    relevant: ['docker', 'server'],
  },

  { category: 'negatif', text: 'Apa ibu kota Australia?', relevant: [] },
  { category: 'negatif', text: 'Jelaskan teori relativitas umum', relevant: [] },
  { category: 'negatif', text: "Terjemahkan 'selamat pagi' ke bahasa Prancis", relevant: [] },
  { category: 'negatif', text: 'Berapa jarak bumi ke bulan?', relevant: [] },
  { category: 'negatif', text: 'Siapa penemu telepon?', relevant: [] },
  { category: 'negatif', text: 'Resep nasi goreng sederhana', relevant: [] },
];
