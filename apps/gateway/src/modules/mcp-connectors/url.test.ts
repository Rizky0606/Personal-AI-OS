import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors.js';
import { assertSameOriginRedirect, originOf, parseConnectorUrl } from './url.js';

const reason = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? `${error.code}: ${error.message}` : String(error);
  }
  return 'tidak melempar';
};

describe('aturan URL konektor', () => {
  it('menerima https publik di port bawaan dan 443', () => {
    expect(parseConnectorUrl('https://api.githubcopilot.com/mcp/').host).toBe(
      'api.githubcopilot.com',
    );
    // Port 443 eksplisit dinormalkan hilang oleh URL, yang justru membuktikan ia port bawaan https.
    expect(parseConnectorUrl('https://contoh.com:443/mcp').toString()).toBe(
      'https://contoh.com/mcp',
    );
  });

  it('menolak skema, kredensial, port, dan fragmen yang tidak diizinkan', () => {
    expect(reason(() => parseConnectorUrl('http://contoh.com/mcp'))).toContain(
      'connector_url_invalid',
    );
    expect(reason(() => parseConnectorUrl('https://user:pw@contoh.com/mcp'))).toContain(
      'nama pengguna',
    );
    expect(reason(() => parseConnectorUrl('https://contoh.com:8443/mcp'))).toContain('port 443');
    expect(reason(() => parseConnectorUrl('https://contoh.com/mcp#x'))).toContain('fragmen');
    expect(reason(() => parseConnectorUrl('bukan url'))).toContain('connector_url_invalid');
    expect(reason(() => parseConnectorUrl('  '))).toContain('kosong');
  });

  it('menolak alamat privat dan loopback', () => {
    expect(reason(() => parseConnectorUrl('https://127.0.0.1/mcp'))).toContain('jaringan privat');
    expect(reason(() => parseConnectorUrl('https://10.0.0.5/mcp'))).toContain('jaringan privat');
    expect(reason(() => parseConnectorUrl('https://[::1]/mcp'))).toContain('jaringan privat');
    expect(reason(() => parseConnectorUrl('https://169.254.169.254/latest'))).toContain(
      'jaringan privat',
    );
  });

  it('loopback hanya terbuka untuk tes lewat allowPrivateHosts', () => {
    const url = parseConnectorUrl('http://127.0.0.1:7777/mcp', { allowPrivateHosts: true });
    expect(originOf(url)).toBe('http://127.0.0.1:7777');
  });

  it('redirect harus tetap di origin yang sama', () => {
    const origin = originOf(parseConnectorUrl('https://contoh.com/mcp'));
    expect(() =>
      assertSameOriginRedirect(new URL('https://contoh.com/mcp/v2'), origin),
    ).not.toThrow();
    expect(
      reason(() => assertSameOriginRedirect(new URL('https://penyerang.com/mcp'), origin)),
    ).toContain('host lain');
    // Redirect ke alamat internal ditolak oleh aturan yang sama, bukan oleh pemeriksaan origin saja.
    expect(
      reason(() => assertSameOriginRedirect(new URL('http://169.254.169.254/'), origin)),
    ).toContain('connector_url_invalid');
  });
});
