/**
 * Set uji murah untuk pemilihan skill oleh agent (P9 task 7): 20 pesan contoh dengan skill yang diharapkan.
 * `expectAny` = bila agent membuka salah satunya, dianggap tepat; kosong = pesan ini tidak butuh skill khusus.
 * `agent` menentukan mesin dan paket skill yang berlaku (frontend/backend hanya untuk agent project).
 */
export interface SkillEvalCase {
  group: 'umum' | 'coding' | 'riset' | 'menulis' | 'video';
  agent: 'general' | 'project';
  message: string;
  expectAny: readonly string[];
}

export const SKILL_EVAL_CASES: readonly SkillEvalCase[] = [
  { group: 'umum', agent: 'general', message: 'Apa ibu kota Australia?', expectAny: [] },
  {
    group: 'umum',
    agent: 'general',
    message: 'Jelaskan beda TCP dan UDP secara singkat.',
    expectAny: [],
  },
  {
    group: 'umum',
    agent: 'general',
    message: 'Beri tiga ide sarapan sehat yang cepat.',
    expectAny: [],
  },
  {
    group: 'coding',
    agent: 'general',
    message: 'Fungsi ini crash dengan error null pointer, kenapa bisa begitu?',
    expectAny: ['diagnosing-bugs', 'reproduce-first'],
  },
  {
    group: 'coding',
    agent: 'general',
    message: 'Tolong review kode login ini, apakah ada celah keamanan?',
    expectAny: ['security-basics', 'code-review'],
  },
  {
    group: 'coding',
    agent: 'general',
    message: 'Tombol simpan gagal berfungsi, bantu perbaiki bug-nya.',
    expectAny: ['reproduce-first', 'diagnosing-bugs'],
  },
  {
    group: 'coding',
    agent: 'project',
    message: 'Tambahkan endpoint API baru untuk daftar pesanan dengan validasi input.',
    expectAny: ['api-design', 'input-validation'],
  },
  {
    group: 'coding',
    agent: 'project',
    message:
      'Perbaiki tampilan komponen tombol di halaman login: kontras rendah dan tidak responsif.',
    expectAny: ['ui-baseline', 'a11y-check', 'ui-states'],
  },
  {
    group: 'riset',
    agent: 'general',
    message: 'Bandingkan harga terbaru GPU RTX 5070 dan RX 9070, sertakan sumbernya.',
    expectAny: ['source-verification', 'citation'],
  },
  {
    group: 'riset',
    agent: 'general',
    message: 'Riset tren statistik adopsi mobil listrik di Asia Tenggara.',
    expectAny: ['source-verification'],
  },
  {
    group: 'riset',
    agent: 'general',
    message: 'Cari studi tentang tidur dan memori, pisahkan mana fakta dan mana opini.',
    expectAny: ['fact-vs-opinion', 'source-verification'],
  },
  {
    group: 'riset',
    agent: 'general',
    message: 'Berikan referensi yang rapi untuk klaim bahwa kopi menurunkan risiko diabetes.',
    expectAny: ['citation', 'source-verification'],
  },
  {
    group: 'menulis',
    agent: 'general',
    message: 'Tulis ulang email ini supaya lebih sopan dan singkat.',
    expectAny: ['stop-slop', 'audience-voice'],
  },
  {
    group: 'menulis',
    agent: 'general',
    message: 'Buat artikel blog tentang kopi yang tidak terdengar seperti tulisan AI.',
    expectAny: ['stop-slop'],
  },
  {
    group: 'menulis',
    agent: 'general',
    message: 'Tulis naskah pidato wisuda dua menit untuk mahasiswa teknik.',
    expectAny: ['script-structure', 'audience-voice'],
  },
  {
    group: 'menulis',
    agent: 'general',
    message: 'Susun postingan newsletter bulanan untuk pelanggan toko buku.',
    expectAny: ['audience-voice', 'stop-slop'],
  },
  {
    group: 'video',
    agent: 'general',
    message: 'Buat skrip video TikTok 30 detik tentang menabung untuk anak muda.',
    expectAny: ['script-structure', 'audience-voice'],
  },
  {
    group: 'video',
    agent: 'general',
    message: 'Tulis naskah video YouTube tutorial Excel dengan hook yang kuat.',
    expectAny: ['script-structure'],
  },
  {
    group: 'video',
    agent: 'general',
    message: 'Buat caption video reels untuk toko roti keluarga.',
    expectAny: ['audience-voice', 'stop-slop'],
  },
  {
    group: 'video',
    agent: 'general',
    message: 'Tulis thread konten tentang produktivitas dengan gaya santai.',
    expectAny: ['audience-voice', 'stop-slop'],
  },
];
