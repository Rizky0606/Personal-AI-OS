import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  matchTotp,
  otpauthUri,
  timeStep,
  totpCode,
} from './totp.js';

/** Secret uji RFC 6238 Appendix B: ASCII "12345678901234567890". */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('base32', () => {
  it('cocok dengan vektor RFC 4648', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
  });

  it('bolak-balik untuk byte acak dan mengabaikan spasi, tanda hubung, huruf kecil', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const spaced = secret.toLowerCase().replace(/(.{4})/g, '$1 ');
    expect(base32Decode(spaced).equals(base32Decode(secret))).toBe(true);
  });

  it('menolak karakter di luar alfabet', () => {
    expect(() => base32Decode('ABC1')).toThrow();
  });
});

describe('TOTP RFC 6238', () => {
  // Vektor SHA-1 dari RFC 6238 (kode 8 digit); 6 digit = 6 digit terakhir.
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i detik', (seconds, eightDigits) => {
    const step = timeStep(seconds * 1000);
    expect(totpCode(RFC_SECRET, step, 8)).toBe(eightDigits);
    expect(totpCode(RFC_SECRET, step)).toBe(eightDigits.slice(-6));
  });
});

describe('matchTotp', () => {
  const secret = generateTotpSecret();
  const at = Date.UTC(2026, 9, 22, 6, 0, 10);
  const step = timeStep(at);

  it('menerima kode langkah sekarang, sebelumnya, dan berikutnya, dan mengembalikan langkahnya', () => {
    expect(matchTotp(secret, totpCode(secret, step), at)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, step - 1), at)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), at)).toBe(step + 1);
  });

  it('menolak kode dua langkah atau lebih jauh', () => {
    expect(matchTotp(secret, totpCode(secret, step - 2), at)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, step + 2), at)).toBeNull();
  });

  it('menolak kode salah, panjang salah, dan bukan angka', () => {
    const good = totpCode(secret, step);
    const wrong = good === '000000' ? '000001' : '000000';
    expect(matchTotp(secret, wrong, at)).toBeNull();
    expect(matchTotp(secret, good.slice(1), at)).toBeNull();
    expect(matchTotp(secret, `${good} `, at)).toBeNull();
    expect(matchTotp(secret, 'abcdef', at)).toBeNull();
    expect(matchTotp(secret, '', at)).toBeNull();
  });

  it('kode dari secret lain ditolak', () => {
    expect(matchTotp(generateTotpSecret(), totpCode(secret, step), at)).toBeNull();
  });
});

describe('otpauthUri', () => {
  it('memuat secret, issuer, dan parameter standar', () => {
    const uri = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'owner', 'Personal AI OS'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.hostname).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Personal AI OS:owner');
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'Personal AI OS',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});
