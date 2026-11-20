import { MEMORY_TEXT_MAX } from './entities.js';

/**
 * Niat "ingat ini" di pesan pemilik dan fakta ringkasnya, tanpa panggilan model (heuristik tetap). Dipakai gateway
 * (jaring pengaman: event `memory.suggested` bila tidak ada tool memori yang berhasil di giliran itu) dan desktop
 * (isi awal dialog "Ingat ini"). Hanya kalimat yang DIAWALI permintaan mengingat yang dikenali, termasuk permintaan
 * usulan ("usulkan untuk menyimpan ke memori bahwa…", "propose a memory: …"); pertanyaan ("ingat nggak…?") dan
 * kalimat lain tidak. Niat menjadwalkan (`scheduleRequestFrom`) ditangani terpisah.
 */

const POLITE = String.raw`(?:(?:tolong|mohon|coba|please|pls|plz|bisa|bisakah|boleh)\s+)*(?:(?:kamu|kau|lo|lu|you)\s+)?`;
/** "usulkan", "ajukan", "propose", boleh diikuti "juga/untuk/agar/supaya". */
const PROPOSE = String.raw`(?:usulkan|ajukan|propose)(?:\s+(?:juga|untuk|agar|supaya))*\s+`;
const VERB = String.raw`(?:ingat(?:lah|kan|-ingat)?|diingat|ingetin|inget(?:in)?|catat(?:lah|kan)?|dicatat|simpan(?:lah|kan)?\s+(?:ke|di|dalam)\s+(?:memori|ingatan)(?:mu)?|remember|note|memorize|keep\s+in\s+mind|${PROPOSE}(?:(?:menyimpan|simpan|disimpan)\s+(?:(?:ini|itu)\s+)?(?:ke|di|dalam)\s+(?:memori|ingatan)(?:mu)?|(?:a\s+|sebuah\s+)?(?:memori|memory|ingatan)|diingat))`;
const TAIL = String.raw`(?:\s+(?:ya|yah|yaa|ini|itu|baik-baik|baik2))*\s*[,:;.!-]?\s*(?:(?:bahwa|kalau|kalo|klo|that)\s+)?`;
const LEAD = new RegExp(`^\\s*${POLITE}${VERB}${TAIL}`, 'i');
/**
 * Awal permintaan menjadwalkan: "jadwalkan…", "buatkan jadwal/pengingat…", "usulkan jadwal…", "propose a schedule…",
 * "remind me…", atau "ingatkan saya" yang disertai penanda waktu (setiap, besok, jam, 16.00). "Ingatkan saya" tanpa
 * penanda waktu tetap permintaan mengingat biasa.
 */
const SCHEDULE_LEAD = new RegExp(
  `^\\s*${POLITE}(?:jadwalkan|jadwalin|schedule|remind\\s+me|` +
    String.raw`(?:buat(?:kan|in)?|bikin(?:kan|in)?|atur(?:kan)?|tambah(?:kan)?|pasang(?:kan)?|set|create|add)\s+(?:(?:sebuah|satu|1|a|an)\s+)?(?:jadwal|pengingat|reminder|schedule)|` +
    `${PROPOSE}(?:(?:sebuah|satu|1|a|an)\\s+)?(?:usulan\\s+)?(?:jadwal|pengingat|reminder|schedule)|` +
    String.raw`ingatkan\s+(?:saya|aku|gue|gw|kami)(?=.*\b(?:setiap|tiap|besok|lusa|nanti|jam|pukul|harian|mingguan|bulanan|pagi|siang|sore|malam|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b|.*\b\d{1,2}[.:]\d{2}\b))\b`,
  'i',
);
/** Batas teks permintaan jadwal di event `schedule.suggested`. */
export const SCHEDULE_REQUEST_MAX = 500;
/** Bukan permintaan: "ingat nggak…", "ingat tidak…". */
const QUESTION_AFTER = /^(?:nggak|ngga|gak|ga|enggak|engga|tidak|tak|kah|ndak)\b/i;
/** Penutup basa-basi yang dibuang dari fakta. */
const TRAILING =
  /(?:[\s,]+(?:ya|yah|yaa|ok|oke|okay|thanks|thank you|terima kasih|makasih|trims|tq|please|pls))+[.!\s]*$/i;

/**
 * Permintaan menjadwalkan (atau mengusulkan jadwal) di awal pesan pemilik, atau `null`. Hasilnya kalimat pertama
 * permintaan itu (jam seperti "16.00" tidak memotong kalimat), dipakai gateway untuk event `schedule.suggested`
 * bila tidak ada tool `schedule_propose` yang berhasil di giliran itu.
 */
export function scheduleRequestFrom(message: string): string | null {
  const text = message.replace(/\s+/g, ' ').trim();
  if (!SCHEDULE_LEAD.test(text)) return null;
  const sentence = (/^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text).trim();
  // "Schedule saya besok apa?" adalah pertanyaan; "Bisa jadwalkan …?" tetap permintaan.
  const polite = /^(?:tolong|mohon|please|pls|bisa|bisakah|boleh|can|could)\b/i.test(text);
  if (sentence.endsWith('?') && !polite) return null;
  const request = sentence
    .replace(/[.!?]+$/, '')
    .replace(TRAILING, '')
    .trim();
  if (request.length > SCHEDULE_REQUEST_MAX - 1) {
    return `${request.slice(0, SCHEDULE_REQUEST_MAX - 2).trimEnd()}…`;
  }
  return `${request}.`;
}

/** Kata ganti orang pertama (bahasa Indonesia) menjadi "pemilik", supaya fakta bisa dibaca di chat mana pun. */
function thirdPerson(text: string): string {
  return (
    text
      // "…, saya vegetarian" / "dan aku alergi…": subjek berulang dibuang.
      .replace(/([,;]|\b(?:dan|serta|juga|tapi|tetapi))\s+(?:saya|aku|gue|gw)\s+/gi, '$1 ')
      // Subjek di awal.
      .replace(/^(?:saya|aku|gue|gw)\b/i, 'Pemilik')
      // Sisanya (kepemilikan "nama saya", objek "untuk saya").
      .replace(/\b(?:saya|aku|gue|gw)\b/gi, 'pemilik')
  );
}

/**
 * Fakta ringkas dari pesan "tolong ingat bahwa saya…", atau `null` bila pesan tidak diawali permintaan mengingat.
 * Hanya kalimat pertama sesudah permintaan yang diambil; hasil berupa kalimat diawali huruf kapital dan diakhiri titik.
 * "Ingatkan saya setiap Jumat…" adalah permintaan jadwal (`scheduleRequestFrom`), bukan fakta untuk diingat.
 */
export function rememberFactFrom(message: string): string | null {
  const text = message.replace(/\s+/g, ' ').trim();
  if (SCHEDULE_LEAD.test(text)) return null;
  const lead = LEAD.exec(text);
  if (!lead) return null;
  const rest = text.slice(lead[0].length);
  if (!rest || QUESTION_AFTER.test(rest)) return null;
  // Kalimat pertama saja; tanda tanya berarti pertanyaan, bukan fakta.
  const sentence = /^[^.!?\n]*[.!?]?/.exec(rest)?.[0] ?? rest;
  if (sentence.trim().endsWith('?')) return null;
  let fact = thirdPerson(
    sentence
      .replace(/[.!]+$/, '')
      .replace(TRAILING, '')
      .trim(),
  );
  if (fact.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return null;
  fact = `${fact.charAt(0).toUpperCase()}${fact.slice(1)}`;
  if (fact.length > MEMORY_TEXT_MAX - 1) fact = fact.slice(0, MEMORY_TEXT_MAX - 1).trimEnd();
  return `${fact}.`;
}
