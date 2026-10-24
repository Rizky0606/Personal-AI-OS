import { FileRecordSchema, ProblemSchema, SendMessageResponseSchema } from '@aios/contracts';
import { eq } from 'drizzle-orm';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { files, messages, runs } from '../../db/schema/index.js';
import { createAuthEnv, type AuthEnv } from '../../testing/auth-env.js';
import { startFakeHermes, type FakeHermes } from '../../testing/fake-hermes.js';
import { renderReportPdf } from '../research/pdf.js';

let env: AuthEnv;
let hermes: FakeHermes;
let token: string;

beforeAll(async () => {
  hermes = await startFakeHermes();
  env = await createAuthEnv(inject('testDatabaseUrl'), { hermesUrl: hermes.url });
  token = (await env.loginOk({ kind: 'desktop' })).accessToken;
});
afterAll(async () => {
  await env.close();
  await hermes.close();
});
beforeEach(() => {
  hermes.requests.length = 0;
  hermes.onRequest((s) => {
    s.delta('oke');
    s.finish();
    s.done();
  });
});

/** Multipart dibentuk oleh FormData/Response bawaan, sama seperti klien. */
async function upload(
  name: string,
  bytes: Buffer | string,
  mime = '',
  auth: string | null = token,
) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), name);
  const body = new Response(form);
  return env.app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: {
      'content-type': body.headers.get('content-type')!,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    payload: Buffer.from(await body.arrayBuffer()),
  });
}
const uploaded = async (name: string, bytes: Buffer | string, mime = '') => {
  const res = await upload(name, bytes, mime);
  expect(res.statusCode, res.body).toBe(201);
  return FileRecordSchema.parse(res.json());
};
const problem = (res: { json(): unknown }) => ProblemSchema.parse(res.json());

/** DOCX minimal: arsip ZIP berisi word/document.xml (deflate). */
function docx(paragraphs: string[]): Buffer {
  const xml = Buffer.from(
    `<?xml version="1.0"?><w:document><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
      .join('')}</w:body></w:document>`,
  );
  const data = deflateRawSync(xml);
  const name = Buffer.from('word/document.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(xml.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(xml.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('POST /files', () => {
  it('menyimpan berkas teks; nama dibersihkan dari path; isi ada di database, tidak di respons', async () => {
    const record = await uploaded(
      'C:\\Users\\saya\\catatan.md',
      '# Judul\nisi catatan',
      'text/markdown',
    );
    expect(record).toMatchObject({ name: 'catatan.md', mime: 'text/markdown', size: 19 });
    expect(record).not.toHaveProperty('content');
    const [row] = await env.database.handle.db.select().from(files).where(eq(files.id, record.id));
    expect(row!.content.toString('utf8')).toBe('# Judul\nisi catatan');
  });

  it('gambar, PDF, dan DOCX diterima; MIME gambar diisi dari ekstensi bila kosong', async () => {
    expect((await uploaded('layar.png', PNG)).mime).toBe('image/png');
    const pdf = await renderReportPdf('Laporan kuartal', { title: 'Uji' });
    expect((await uploaded('laporan.pdf', pdf, 'application/pdf')).size).toBe(pdf.length);
    expect((await uploaded('surat.docx', docx(['Halo']))).name).toBe('surat.docx');
  });

  it('menolak jenis tak didukung, berkas rusak, berkas kosong, tanpa login, dan bukan multipart', async () => {
    const exe = await upload('setup.exe', 'MZ', 'application/x-msdownload');
    expect([exe.statusCode, problem(exe).code]).toEqual([400, 'unsupported_file_type']);
    const broken = await upload('rusak.pdf', 'bukan pdf', 'application/pdf');
    expect([broken.statusCode, problem(broken).code]).toEqual([400, 'file_unreadable']);
    const binary = await upload('data.txt', Buffer.from([0x41, 0x00, 0x42]), 'text/plain');
    expect(problem(binary).code).toBe('file_unreadable');
    expect(problem(await upload('kosong.txt', '', 'text/plain')).code).toBe('file_empty');
    expect((await upload('a.txt', 'x', 'text/plain', null)).statusCode).toBe(401);
    const json = await env.post('/files', { file: 'x' }, token);
    expect([json.statusCode, problem(json).code]).toEqual([400, 'invalid_upload']);
  });

  it('lebih dari 25 MB ditolak 413', async () => {
    const big = await upload('besar.txt', Buffer.alloc(25 * 1024 * 1024 + 10, 0x61), 'text/plain');
    expect(big.statusCode).toBe(413);
  });
});

describe('chat dengan lampiran', () => {
  const send = async (parts: object[]) => {
    const conv = (await env.post('/conversations', { surface: 'windows' }, token)).json<{
      id: string;
    }>();
    const res = await env.post(`/conversations/${conv.id}/messages`, { parts }, token);
    return { conv, res };
  };
  const finished = async (runId: string) => {
    for (let i = 0; i < 500; i++) {
      const [run] = await env.database.handle.db.select().from(runs).where(eq(runs.id, runId));
      if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('run tidak selesai');
  };
  const userContent = (i = 0) => hermes.requests[i]!.body.messages.at(-1)!.content as unknown;

  it('dokumen menjadi teks di prompt; part file disimpan dengan nama dari database', async () => {
    const doc = await uploaded('surat.docx', docx(['Rapat Senin pukul 09.00', 'Agenda: anggaran']));
    const notes = await uploaded('catatan.txt', 'Budi membawa proyektor', 'text/plain');
    const { res } = await send([
      { type: 'text', text: 'Ringkas lampiran ini' },
      { type: 'file', fileId: doc.id, name: 'nama-palsu.exe', mime: 'x/y' },
      { type: 'file', fileId: notes.id, name: 'x', mime: 'x' },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    const sent = SendMessageResponseSchema.parse(res.json());
    await finished(sent.run.id);

    const prompt = userContent() as string;
    expect(prompt).toContain('Ringkas lampiran ini');
    expect(prompt).toContain('<lampiran nama="surat.docx">');
    expect(prompt).toContain('Rapat Senin pukul 09.00\nAgenda: anggaran');
    expect(prompt).toContain('Budi membawa proyektor');
    const [stored] = await env.database.handle.db
      .select()
      .from(messages)
      .where(eq(messages.id, sent.message.id));
    expect(stored!.parts).toEqual([
      { type: 'text', text: 'Ringkas lampiran ini' },
      { type: 'file', fileId: doc.id, name: 'surat.docx', mime: doc.mime },
      { type: 'file', fileId: notes.id, name: 'catatan.txt', mime: 'text/plain' },
    ]);
  });

  it('gambar dikirim inline sebagai image_url; pesan tanpa teks tetap boleh', async () => {
    const image = await uploaded('layar.png', PNG, 'image/png');
    const { res } = await send([
      { type: 'file', fileId: image.id, name: 'layar.png', mime: 'image/png' },
    ]);
    expect(res.statusCode, res.body).toBe(201);
    await finished(SendMessageResponseSchema.parse(res.json()).run.id);

    expect(userContent()).toEqual([
      { type: 'text', text: 'Lihat gambar terlampir.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } },
    ]);
  });

  it('PDF diekstrak menjadi teks', async () => {
    const pdf = await uploaded(
      'laporan.pdf',
      await renderReportPdf('Pendapatan naik 12 persen', { title: 'Laporan' }),
      'application/pdf',
    );
    const { res } = await send([
      { type: 'text', text: 'Apa isinya?' },
      { type: 'file', fileId: pdf.id, name: 'laporan.pdf', mime: 'application/pdf' },
    ]);
    await finished(SendMessageResponseSchema.parse(res.json()).run.id);
    expect(userContent() as string).toContain('Pendapatan naik 12 persen');
  });
});
