import { describe, expect, it } from 'vitest';
import { elementContext, toAttachment, withAttachments } from './attachment';
import { parseBridgeMessage, type PickMessageData } from './bridge';

const pick: PickMessageData = {
  aios: 'preview',
  type: 'pick',
  selector: 'main > button.simpan',
  html: '<button class="simpan">Simpan</button>',
  text: 'Simpan',
  styles: { width: '600px', display: 'block' },
  rect: { x: 10, y: 20, width: 600, height: 36 },
  viewport: { width: 390, height: 700 },
  url: 'http://127.0.0.1:50123/produk?id=3',
};

describe('elementContext', () => {
  it('memuat selector, path halaman tanpa host, ukuran, HTML, style terhitung, dan petunjuk screenshot', () => {
    const text = elementContext(pick);

    expect(text).toContain('Selector: main > button.simpan');
    expect(text).toContain('Halaman: /produk?id=3');
    expect(text).not.toContain('127.0.0.1');
    expect(text).toContain('Ukuran: 600x36 px pada viewport 390x700');
    expect(text).toContain('<button class="simpan">Simpan</button>');
    expect(text).toContain('width: 600px');
    expect(text).toContain('browser_screenshot dengan selector "main > button.simpan"');
  });

  it('HTML yang sangat panjang dipotong', () => {
    const text = elementContext({ ...pick, html: `<p>${'x'.repeat(5000)}</p>` });
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(4500);
  });
});

describe('lampiran', () => {
  it('toAttachment memberi id stabil per elemen dan halaman, label selector, dan thumbnail opsional', () => {
    const a = toAttachment(pick, 'data:image/png;base64,AAAA');
    expect(a).toMatchObject({
      label: 'main > button.simpan',
      thumbnail: 'data:image/png;base64,AAAA',
    });
    expect(a.id).toBe(toAttachment(pick).id);
    expect(toAttachment(pick).thumbnail).toBeUndefined();
  });

  it('withAttachments menambahkan blok konteks setelah ketikan pengguna; tanpa lampiran tidak berubah', () => {
    expect(withAttachments('perbaiki tombol ini', [])).toBe('perbaiki tombol ini');
    const body = withAttachments('perbaiki tombol ini', [toAttachment(pick)]);
    expect(body.startsWith('perbaiki tombol ini\n\n[Elemen dipilih dari preview]')).toBe(true);
  });
});

describe('parseBridgeMessage', () => {
  it('menerima pesan console dan pick yang sah; membuang yang bentuknya salah atau bukan dari jembatan', () => {
    expect(
      parseBridgeMessage({ aios: 'preview', type: 'console', level: 'error', text: 'x' }),
    ).toMatchObject({
      type: 'console',
    });
    expect(parseBridgeMessage(pick)).toMatchObject({ type: 'pick' });
    expect(parseBridgeMessage({ aios: 'preview', type: 'console', level: 5 })).toBeUndefined();
    expect(parseBridgeMessage({ type: 'console', level: 'log', text: 'x' })).toBeUndefined();
    expect(parseBridgeMessage('teks')).toBeUndefined();
    expect(parseBridgeMessage(null)).toBeUndefined();
  });
});
