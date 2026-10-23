import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://aios:pw@127.0.0.1:5432/aios',
  AUTH_SECRET: 'x'.repeat(40),
};

describe('loadConfig', () => {
  it('memakai default loopback untuk host dan port layanan lokal', () => {
    const c = loadConfig(base);
    expect(c.HOST).toBe('127.0.0.1');
    expect(c.PORT).toBe(3000);
    expect(c.HERMES_URL).toBe('http://127.0.0.1:8642');
    expect(c.NINEROUTER_URL).toBe('http://127.0.0.1:20128/v1');
    expect(c.SEARXNG_URL).toBe('http://127.0.0.1:8888');
    expect(c.READY_TIMEOUT_MS).toBe(2000);
    expect(c.HERMES_API_KEY).toBeUndefined();
  });

  it('produksi menolak HOST non-loopback kecuali ALLOW_PUBLIC_BIND=true', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadConfig({ ...prod, HOST: '0.0.0.0' })).toThrow(/loopback/);
    expect(loadConfig({ ...prod, HOST: '127.0.0.1' }).HOST).toBe('127.0.0.1');
    expect(loadConfig({ ...prod, HOST: '0.0.0.0', ALLOW_PUBLIC_BIND: 'true' }).HOST).toBe(
      '0.0.0.0',
    );
    // Pengembangan dan tes tidak dibatasi.
    expect(loadConfig({ ...base, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
  });

  it('menganggap string kosong dari .env sebagai tidak diisi', () => {
    const c = loadConfig({ ...base, HERMES_API_KEY: '', PORT: '', LOG_LEVEL: ' ' });
    expect(c.HERMES_API_KEY).toBeUndefined();
    expect(c.PORT).toBe(3000);
    expect(c.LOG_LEVEL).toBe('info');
  });

  it('mengonversi angka dari string', () => {
    expect(loadConfig({ ...base, PORT: '8080', READY_TIMEOUT_MS: '500' })).toMatchObject({
      PORT: 8080,
      READY_TIMEOUT_MS: 500,
    });
  });

  it('gagal cepat bila DATABASE_URL hilang', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (err) {
      expect((err as ConfigError).issues.map((i) => i.variable)).toContain('DATABASE_URL');
    }
  });

  it('menolak AUTH_SECRET yang pendek tanpa menampilkan nilainya', () => {
    try {
      loadConfig({ ...base, AUTH_SECRET: 'rahasia-pendek' });
      expect.unreachable();
    } catch (err) {
      expect((err as ConfigError).message).toContain('AUTH_SECRET');
      expect((err as ConfigError).message).not.toContain('rahasia-pendek');
    }
  });

  it('menolak skema URL yang salah, port di luar rentang, dan level log tak dikenal', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, HERMES_URL: 'ftp://x' })).toThrow(ConfigError);
  });

  it('pesan error menyebut nama variabel tetapi tidak pernah nilainya', () => {
    try {
      loadConfig({
        DATABASE_URL: 'mysql://aios:topsecret@host/db',
        HERMES_API_KEY: 'sk-rahasia',
        PORT: 'abc',
      });
      expect.unreachable();
    } catch (err) {
      const message = (err as ConfigError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('PORT');
      expect(message).not.toContain('topsecret');
      expect(message).not.toContain('sk-rahasia');
      expect(message).not.toContain('abc');
    }
  });
});
