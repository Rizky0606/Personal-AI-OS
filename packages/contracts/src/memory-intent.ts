import { MEMORY_TEXT_MAX } from './entities.js';

/**
 * Niat "ingat ini" di pesan pemilik dan fakta ringkasnya, tanpa panggilan model (heuristik tetap). Dipakai gateway
 * (jaring pengaman: event `memory.suggested` bila tidak ada tool memori yang berhasil di giliran itu) dan desktop
 * (isi awal dialog "Ingat ini"). Hanya kalimat yang DIAWALI permintaan mengingat yang dikenali; pertanyaan
 * ("ingat nggak…?") dan kalimat lain tidak.
 */

const POLITE = String.raw`(?:(?:tolong|mohon|coba|please|pls|plz|bisa|bisakah|boleh)\s+)*(?:(?:kamu|kau|lo|lu|you)\s+)?`;
const VERB = String.raw`(?:ingat(?:lah|kan|-ingat)?|diingat|ingetin|inget(?:in)?|catat(?:lah|kan)?|dicatat|simpan(?:lah|kan)?\s+(?:ke|di|dalam)\s+(?:memori|ingatan)(?:mu)?|remember|note|memorize|keep\s+in\s+mind)`;
const TAIL = String.raw`(?:\s+(?:ya|yah|yaa|ini|itu|baik-baik|baik2))*\s*[,:;.!-]?\s*(?:(?:bahwa|kalau|kalo|klo|that)\s+)?`;
const LEAD = new RegExp(`^\\s*${POLITE}${VERB}${TAIL}`, 'i');
/** Bukan permintaan: "ingat nggak…", "ingat tidak…". */
const QUESTION_AFTER = /^(?:nggak|ngga|gak|ga|enggak|engga|tidak|tak|kah|ndak)\b/i;
/** Penutup basa-basi yang dibuang dari fakta. */
const TRAILING =
  /(?:[\s,]+(?:ya|yah|yaa|ok|oke|okay|thanks|thank you|terima kasih|makasih|trims|tq|please|pls))+[.!\s]*$/i;

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
 */
export function rememberFactFrom(message: string): string | null {
  const text = message.replace(/\s+/g, ' ').trim();
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
