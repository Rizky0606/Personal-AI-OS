import type { SkillScan } from '@aios/contracts';

/**
 * Pemindai skill (P10): aturan saja, tanpa model dan tanpa dependensi. Isi skill pihak ketiga adalah data
 * tak tepercaya; pemindai ini bukan jaminan keamanan, hanya saringan pertama sebelum manusia membaca isinya.
 *
 * Hasil: `safe` (tidak ada temuan), `warning` (butuh konfirmasi eksplisit), `dangerous` (diblokir untuk
 * skill dari luar). Setiap temuan menandai nomor baris supaya UI bisa menyorotnya.
 */

interface Rule {
  rule: string;
  severity: 'warning' | 'danger';
  message: string;
  pattern: RegExp;
}

/** Karakter tak terlihat yang dipakai menyembunyikan instruksi: zero-width dan kontrol arah teks (bidi). */
const INVISIBLE = /[\u200B-\u200F\u2060-\u2064\u202A-\u202E\u2066-\u2069\u00AD]/;

const RULES: readonly Rule[] = [
  // --- prompt injection (Inggris dan Indonesia)
  {
    rule: 'prompt-injection',
    severity: 'danger',
    message: 'Frasa yang memerintahkan agent mengabaikan instruksi sebelumnya.',
    pattern:
      /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|directives?|constraints?)\b/i,
  },
  {
    rule: 'prompt-injection',
    severity: 'danger',
    message: 'Frasa yang memerintahkan agent mengabaikan instruksi sebelumnya (Indonesia).',
    pattern:
      /\b(abaikan|lupakan|kesampingkan|langgar|timpa)\b[^.\n]{0,40}\b(instruksi|perintah|aturan|petunjuk|arahan|batasan)\b/i,
  },
  {
    rule: 'prompt-injection',
    severity: 'danger',
    message: 'Meminta agent mengungkap system prompt atau instruksi tersembunyinya.',
    pattern:
      /\b(reveal|show|print|output|repeat|leak|display|dump|expose)\b[^.\n]{0,40}\b(system|hidden|initial|secret)\s+(prompt|instructions?|message)\b/i,
  },
  {
    rule: 'prompt-injection',
    severity: 'danger',
    message: 'Meminta agent mengungkap system prompt atau instruksi tersembunyinya (Indonesia).',
    pattern:
      /\b(ungkap(?:kan)?|tampilkan|bocorkan|cetak|tunjukkan|beberkan)\b[^.\n]{0,40}\b(system\s*prompt|prompt\s+sistem|instruksi\s+(?:sistem|tersembunyi|rahasia))\b/i,
  },
  {
    rule: 'prompt-injection',
    severity: 'danger',
    message: 'Mengubah identitas atau menghapus pembatas agent ("you are now", "mode DAN").',
    pattern:
      /\b(you are now|from now on you are|act as if you have no|jailbreak|do anything now|developer mode enabled)\b|\bsekarang kamu adalah\b|\btanpa batasan apa pun\b/i,
  },
  {
    rule: 'conceal-from-user',
    severity: 'danger',
    message: 'Menyuruh agent menyembunyikan tindakan dari pengguna.',
    pattern:
      /\b(do not|don't|never)\s+(tell|inform|mention|reveal|show)\b[^.\n]{0,30}\b(the\s+)?user\b|\bjangan\s+(beri\s*tahu|katakan|sebutkan|tunjukkan)\b[^.\n]{0,30}\bpengguna\b/i,
  },
  // --- pengiriman data keluar
  {
    rule: 'exfiltration',
    severity: 'danger',
    message: 'Tujuan unggah/webhook yang lazim dipakai mengirim data keluar.',
    pattern:
      /(webhook\.site|requestbin|pipedream\.net|ngrok(?:-free)?\.(?:io|app|dev)|hooks\.slack\.com|discord(?:app)?\.com\/api\/webhooks|pastebin\.com|transfer\.sh|oast\.(?:pro|live|site|online|fun|me)|interact\.sh)/i,
  },
  {
    rule: 'exfiltration',
    severity: 'danger',
    message: 'Perintah yang mengunggah isi berkas atau data ke alamat luar.',
    pattern:
      /\b(curl|wget|http|Invoke-WebRequest|iwr)\b[^\n]{0,80}(\s-d\b|\s--data\b|\s-F\b|\s--form\b|\s--upload-file\b|\s-T\b|\s-X\s*POST\b|-OutFile\b[^\n]*\bbody\b)/i,
  },
  {
    rule: 'exfiltration',
    severity: 'warning',
    message: 'Meminta data dikirim ke tempat lain; periksa tujuannya.',
    pattern:
      /\b(kirim(?:kan)?|unggah|upload|post)\b[^.\n]{0,40}\b(data|isi|berkas|file|rahasia|token|kredensial|log|riwayat|percakapan)\b[^.\n]{0,30}\b(ke|to)\b|\b(send|upload|post|exfiltrate|forward)\b[^.\n]{0,40}\b(data|contents?|files?|secrets?|tokens?|credentials?|logs?|history|conversation)\b[^.\n]{0,30}\bto\b/i,
  },
  // --- perintah merusak
  {
    rule: 'destructive-command',
    severity: 'danger',
    message: 'Perintah penghapusan rekursif paksa.',
    pattern:
      /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive\s+--force|--force\s+--recursive)\b|\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force|\brmdir\s+\/s\b|\bdel\s+\/[fsq]\b/i,
  },
  {
    rule: 'destructive-command',
    severity: 'danger',
    message: 'Perintah memformat atau menimpa disk.',
    pattern:
      /\bmkfs(\.\w+)?\b|\bformat\s+[a-z]:|\bdd\s+if=[^\n]*\bof=\/dev\/|>\s*\/dev\/(sd|nvme|disk)|:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/i,
  },
  {
    rule: 'remote-code-execution',
    severity: 'danger',
    message:
      'Mengunduh lalu langsung menjalankan kode (curl/wget ... | sh) atau Invoke-Expression.',
    pattern:
      /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(Invoke-Expression|iex)\b|\beval\s*\(\s*(atob|Buffer\.from|base64)|\bpowershell\b[^\n]*-(enc|encodedcommand)\b/i,
  },
  {
    rule: 'destructive-command',
    severity: 'warning',
    message: 'Mengubah izin secara luas atau memakai hak administrator.',
    pattern: /\bchmod\s+-R\s+0?777\b|\bsudo\s+rm\b|\bchown\s+-R\s+root\b/i,
  },
  // --- membaca rahasia
  {
    rule: 'secret-access',
    severity: 'danger',
    message: 'Membaca berkas rahasia (kunci SSH, kredensial cloud, /etc/passwd).',
    pattern:
      /(~|\$HOME|%USERPROFILE%)?[/\\]?\.ssh[/\\]|\bid_(rsa|ed25519|ecdsa)\b|\.aws[/\\]credentials|\/etc\/(passwd|shadow)\b|\.config[/\\]gh[/\\]hosts|\.git-credentials|\.npmrc\b|\.netrc\b/i,
  },
  {
    rule: 'secret-access',
    severity: 'warning',
    message: 'Menyebut berkas .env atau variabel rahasia; pastikan tidak dibaca atau dikirim.',
    pattern:
      /(^|[\s"'`/\\])\.env(\.[a-z]+)?\b|\b(api[_ -]?key|secret[_ -]?key|access[_ -]?token|private[_ -]?key|password|kata sandi)\b[^\n]{0,40}\b(read|cat|print|echo|baca|tampilkan|cetak|salin|copy)\b|\b(read|cat|print|echo|baca|tampilkan|cetak|salin|copy)\b[^\n]{0,40}\b(api[_ -]?key|secret[_ -]?key|access[_ -]?token|private[_ -]?key|password|kata sandi)\b/i,
  },
];

const BASE64_BLOCK = /[A-Za-z0-9+/]{200,}={0,2}/;
const MAX_FINDINGS = 50;

const clip = (text: string, max = 120): string => {
  const one = text.trim().replace(/\s+/g, ' ');
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** Hapus karakter tak terlihat dan ratakan bentuk huruf agar variasi unicode tidak lolos dari aturan. */
const normalizeLine = (line: string): string =>
  line.replace(new RegExp(INVISIBLE.source, 'g'), '').normalize('NFKC');

export function scanSkill(input: { body: string; description?: string }): SkillScan {
  const findings: SkillScan['findings'] = [];
  const add = (f: SkillScan['findings'][number]) => {
    if (findings.length < MAX_FINDINGS) findings.push(f);
  };

  const scanText = (text: string, firstLine: number, label: string) => {
    const lines = text.split(/\r?\n/);
    lines.forEach((raw, index) => {
      const line = firstLine + index;
      // BOM di awal berkas bukan serangan.
      const content = index === 0 && raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
      if (INVISIBLE.test(content)) {
        add({
          rule: 'invisible-characters',
          severity: 'danger',
          line,
          excerpt: clip(
            content.replace(
              new RegExp(INVISIBLE.source, 'g'),
              (c) => `<U+${c.codePointAt(0)!.toString(16).toUpperCase()}>`,
            ),
          ),
          message: `${label}Karakter tak terlihat (zero-width/bidi) dapat menyembunyikan instruksi.`,
        });
      }
      const normalized = normalizeLine(content);
      for (const rule of RULES) {
        if (rule.pattern.test(normalized)) {
          add({
            rule: rule.rule,
            severity: rule.severity,
            line,
            excerpt: clip(normalized),
            message: `${label}${rule.message}`,
          });
        }
      }
      if (BASE64_BLOCK.test(normalized)) {
        add({
          rule: 'encoded-payload',
          severity: 'warning',
          line,
          excerpt: clip(normalized, 80),
          message: `${label}Blok base64 panjang; isinya tidak bisa dibaca manusia.`,
        });
      }
    });
  };

  if (input.description) scanText(input.description, 0, 'Deskripsi: ');
  scanText(input.body, 1, '');

  const verdict: SkillScan['verdict'] = findings.some((f) => f.severity === 'danger')
    ? 'dangerous'
    : findings.length > 0
      ? 'warning'
      : 'safe';
  return { verdict, findings };
}
