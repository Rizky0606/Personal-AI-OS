import { describe, expect, it } from 'vitest';
import { parseServerUrl } from './serverUrl';

describe('parseServerUrl', () => {
  it('menambah https dan membuang garis miring penutup', () => {
    expect(parseServerUrl('aios.contoh.com')).toEqual({ ok: true, url: 'https://aios.contoh.com' });
    expect(parseServerUrl('  https://aios.contoh.com/ ')).toEqual({
      ok: true,
      url: 'https://aios.contoh.com',
    });
    expect(parseServerUrl('aios.contoh.com:8443')).toEqual({
      ok: true,
      url: 'https://aios.contoh.com:8443',
    });
  });

  it('mempertahankan path di belakang reverse proxy', () => {
    expect(parseServerUrl('https://contoh.com/aios/')).toEqual({
      ok: true,
      url: 'https://contoh.com/aios',
    });
  });

  it('kosong dan tidak valid', () => {
    expect(parseServerUrl('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseServerUrl('https://')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseServerUrl('ftp://contoh.com')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseServerUrl('https://contoh.com/?x=1')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseServerUrl('https://user:pw@contoh.com')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('HTTP hanya untuk loopback', () => {
    expect(parseServerUrl('http://aios.contoh.com')).toEqual({ ok: false, reason: 'insecure' });
    expect(parseServerUrl('http://192.168.1.5:3000')).toEqual({ ok: false, reason: 'insecure' });
    expect(parseServerUrl('http://localhost:3000')).toEqual({
      ok: true,
      url: 'http://localhost:3000',
    });
    expect(parseServerUrl('http://127.0.0.1:3000')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:3000',
    });
  });
});
