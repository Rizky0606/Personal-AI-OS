import { loadRegistry } from '@aios/roles';
import { describe, expect, it } from 'vitest';
import { extractProposals, findSecret } from './proposals.js';

const valid = {
  kind: 'new',
  name: 'Rapikan changelog',
  description: 'Saat merapikan changelog rilis: kelompokkan per jenis perubahan.',
  body: '1. Baca commit sejak rilis terakhir.\n2. Kelompokkan: fitur, perbaikan, internal.\n3. Tulis satu baris per perubahan.',
  reason: 'Langkah ini diulang tiga kali dalam percakapan ini dan bisa dipakai ulang.',
};
const fence = (payload: unknown) =>
  '```aios-skill-proposal\n' +
  (typeof payload === 'string' ? payload : JSON.stringify(payload)) +
  '\n```';

describe('extractProposals: blok valid', () => {
  it('mengambil usulan dan membuang blok dari teks, sisa jawaban tidak berubah', () => {
    const answer = `Changelog sudah dirapikan.\n\n${fence(valid)}\n\nSilakan periksa hasilnya.`;
    const out = extractProposals(answer);
    expect(out.found).toBe(1);
    expect(out.accepted).toMatchObject({ kind: 'new', name: 'Rapikan changelog' });
    expect(out.rejected).toEqual([]);
    expect(out.text).toBe('Changelog sudah dirapikan.\n\nSilakan periksa hasilnya.');
    expect(out.text).not.toContain('aios-skill-proposal');
  });

  it('blok di awal atau di akhir jawaban tidak meninggalkan baris kosong di tepi', () => {
    expect(extractProposals(`${fence(valid)}\n\nSelesai.`).text).toBe('Selesai.');
    expect(extractProposals(`Selesai.\n\n${fence(valid)}`).text).toBe('Selesai.');
    expect(extractProposals(`${fence(valid)}\n\nSatu.\n\n${fence(valid)}`).text).toBe('Satu.');
  });

  it('usulan patch wajib punya targetId', () => {
    const noTarget = extractProposals(fence({ ...valid, kind: 'patch' }));
    expect(noTarget.accepted).toBeNull();
    expect(noTarget.rejected).toEqual(['schema']);
    const withTarget = extractProposals(
      fence({ ...valid, kind: 'patch', targetId: 'rapikan-changelog' }),
    );
    expect(withTarget.accepted).toMatchObject({ kind: 'patch', targetId: 'rapikan-changelog' });
  });

  it('kunci tak dikenal diabaikan, bukan menggagalkan blok', () => {
    const out = extractProposals(fence({ ...valid, catatan: 'tambahan agent' }));
    expect(out.accepted?.name).toBe('Rapikan changelog');
  });

  it('blok lain (aios-ui, kode) tidak disentuh', () => {
    const ui = '```aios-ui\n{"version":1,"components":[]}\n```';
    const code = '```ts\nconst a = 1;\n```';
    const out = extractProposals(`${ui}\n\n${fence(valid)}\n\n${code}`);
    expect(out.text).toBe(`${ui}\n\n${code}`);
  });

  it('maksimal satu usulan per jawaban: blok kedua dibuang dan dicatat sebagai extra', () => {
    const second = { ...valid, name: 'Usulan kedua' };
    const out = extractProposals(`${fence(valid)}\n\n${fence(second)}`);
    expect(out.found).toBe(2);
    expect(out.accepted?.name).toBe('Rapikan changelog');
    expect(out.rejected).toEqual(['extra']);
    expect(out.text).toBe('');
  });

  it('jawaban tanpa blok dikembalikan persis sama', () => {
    const text = 'Jawaban biasa.\n\n\n\nDengan jarak kosong yang sengaja.';
    expect(extractProposals(text)).toEqual({ text, found: 0, accepted: null, rejected: [] });
  });
});

describe('extractProposals: blok rusak diabaikan tanpa merusak jawaban', () => {
  it.each([
    ['JSON tidak valid', '{"kind": "new", name: }', 'json'],
    ['bukan objek', '[1,2,3]', 'schema'],
    ['kind tidak dikenal', JSON.stringify({ ...valid, kind: 'hapus' }), 'schema'],
    ['nama kosong', JSON.stringify({ ...valid, name: '  ' }), 'schema'],
    [
      'deskripsi >200 karakter',
      JSON.stringify({ ...valid, description: 'x'.repeat(201) }),
      'schema',
    ],
    ['alasan hilang', JSON.stringify({ ...valid, reason: undefined }), 'schema'],
    ['isi >64 KB', JSON.stringify({ ...valid, body: 'x'.repeat(64 * 1024 + 1) }), 'schema'],
    [
      'isi membawa frontmatter',
      JSON.stringify({ ...valid, body: '---\nname: x\n---\nisi' }),
      'frontmatter',
    ],
  ])('%s', (_label, payload, why) => {
    const out = extractProposals(`Teks awal.\n\n${fence(payload)}\n\nTeks akhir.`);
    expect(out.accepted).toBeNull();
    expect(out.rejected).toEqual([why]);
    // Blok rusak tetap dibuang dari tampilan; sisa jawaban utuh.
    expect(out.text).toBe('Teks awal.\n\nTeks akhir.');
  });

  it('pagar yang tidak ditutup dibiarkan (tidak bisa dibatasi dengan pasti) dan tidak membuat usulan', () => {
    const text = `Teks.\n\n\`\`\`aios-skill-proposal\n${JSON.stringify(valid)}`;
    const out = extractProposals(text);
    expect(out.found).toBe(0);
    expect(out.accepted).toBeNull();
    expect(out.text).toBe(text);
  });

  it('blok rusak tidak menghalangi blok valid sesudahnya', () => {
    const out = extractProposals(`${fence('{rusak')}\n\n${fence(valid)}`);
    expect(out.rejected).toEqual(['json']);
    expect(out.accepted?.name).toBe('Rapikan changelog');
  });
});

describe('rahasia ditolak', () => {
  const secrets: [string, string][] = [
    ['kunci pribadi', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----'],
    ['kunci akses AWS', 'export AWS_KEY=AKIAIOSFODNN7EXAMPLE'],
    ['token GitHub', 'gunakan ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'],
    ['kunci gaya sk-', 'OPENAI sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'],
    ['token Slack', 'xoxb-1234567890-abcdefghij'],
    [
      'JWT',
      'Authorization eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ],
    ['Bearer panjang', 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"'],
    ['URL berkredensial', 'git clone https://deploy:hunter2secret@github.com/acme/repo.git'],
    ['kata sandi literal', 'password = "Sup3rS3cretPass99"'],
  ];

  it.each(secrets)('%s di isi skill', (_label, secret) => {
    const out = extractProposals(fence({ ...valid, body: `Langkah:\n${secret}` }));
    expect(out.accepted).toBeNull();
    expect(out.rejected).toEqual(['secret']);
  });

  it('rahasia di alasan atau deskripsi juga ditolak', () => {
    expect(
      extractProposals(fence({ ...valid, reason: 'token ghp_' + 'A'.repeat(36) })).rejected,
    ).toEqual(['secret']);
  });

  it('laporan penolakan tidak pernah memuat nilai rahasia', () => {
    const out = extractProposals(fence({ ...valid, body: 'AKIAIOSFODNN7EXAMPLE' }));
    expect(JSON.stringify(out)).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('placeholder dan kata biasa bukan rahasia', () => {
    for (const ok of [
      'password: <isi dari secret manager>',
      'token: ${GITHUB_TOKEN}',
      'Kata sandi disimpan di password manager, jangan ditulis di berkas.',
      'api_key = os.environ["API_KEY"]',
      'Gunakan token pendek untuk uji',
    ]) {
      expect(findSecret(ok), ok).toBeNull();
    }
    expect(
      extractProposals(fence({ ...valid, body: 'Set password: <isi sendiri> lalu simpan.' }))
        .accepted,
    ).not.toBeNull();
  });
});

describe('contoh di skill propose-skill', () => {
  it('contoh blok di dalam skill diterima pengurai sungguhan (agent yang menirunya tidak ditolak)', () => {
    const body = loadRegistry().skills.get('propose-skill')!.body;
    const out = extractProposals(`Saya mengusulkan skill.\n\n${body}`);
    expect(out.rejected).toEqual([]);
    expect(out.accepted).toMatchObject({ kind: 'new', name: 'Rapikan changelog' });
  });
});
