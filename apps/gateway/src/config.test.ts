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

  it('MCP_TOOLS_ENABLED bawaan mati; hanya true/false yang diterima', () => {
    expect(loadConfig(base).MCP_TOOLS_ENABLED).toBe('false');
    expect(loadConfig({ ...base, MCP_TOOLS_ENABLED: '' }).MCP_TOOLS_ENABLED).toBe('false');
    expect(loadConfig({ ...base, MCP_TOOLS_ENABLED: 'true' }).MCP_TOOLS_ENABLED).toBe('true');
    expect(() => loadConfig({ ...base, MCP_TOOLS_ENABLED: 'ya' })).toThrow(/MCP_TOOLS_ENABLED/);
  });

  it('MCP_HERMES_TOKEN_SHA256 opsional (kosong = Hermes mati); bila diisi wajib SHA-256 heks, pesan tanpa nilai', () => {
    expect(loadConfig(base).MCP_HERMES_TOKEN_SHA256).toBeUndefined();
    expect(loadConfig({ ...base, MCP_HERMES_TOKEN_SHA256: '' }).MCP_HERMES_TOKEN_SHA256).toBe(
      undefined,
    );
    const hash = 'a'.repeat(64);
    expect(loadConfig({ ...base, MCP_HERMES_TOKEN_SHA256: hash }).MCP_HERMES_TOKEN_SHA256).toBe(
      hash,
    );
    const token = 'token-mentah-bukan-hash-1234567890';
    let error: unknown;
    try {
      loadConfig({ ...base, MCP_HERMES_TOKEN_SHA256: token });
    } catch (err) {
      error = err;
    }
    expect(String(error)).toMatch(/MCP_HERMES_TOKEN_SHA256/);
    expect(String(error)).not.toContain(token);
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

  it('anggaran recall memori opsional: kosong = bawaan modul, angka dikonversi, nilai di luar batas ditolak', () => {
    const blank = loadConfig({ ...base, MEMORY_RECALL_BUDGET_CHARS: '', MEMORY_RECALL_TOP_K: ' ' });
    expect(blank.MEMORY_RECALL_BUDGET_CHARS).toBeUndefined();
    expect(blank.MEMORY_RECALL_TOP_K).toBeUndefined();
    expect(
      loadConfig({ ...base, MEMORY_RECALL_BUDGET_CHARS: '4000', MEMORY_RECALL_TOP_K: '0' }),
    ).toMatchObject({ MEMORY_RECALL_BUDGET_CHARS: 4000, MEMORY_RECALL_TOP_K: 0 });
    expect(() => loadConfig({ ...base, MEMORY_RECALL_BUDGET_CHARS: '50' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, MEMORY_RECALL_TOP_K: '51' })).toThrow(ConfigError);
  });

  it('ekstraksi memori bawaan off dengan model router-fast dan 40 panggilan per hari', () => {
    expect(loadConfig(base)).toMatchObject({
      MEMORY_EXTRACT_MODE: 'off',
      MEMORY_EXTRACT_MODEL: 'router-fast',
      MEMORY_EXTRACT_DAILY_MAX: 40,
    });
    expect(loadConfig({ ...base, MEMORY_EXTRACT_MODE: '' }).MEMORY_EXTRACT_MODE).toBe('off');
    expect(
      loadConfig({ ...base, MEMORY_EXTRACT_MODE: 'propose', MEMORY_EXTRACT_DAILY_MAX: '5' }),
    ).toMatchObject({ MEMORY_EXTRACT_MODE: 'propose', MEMORY_EXTRACT_DAILY_MAX: 5 });
    expect(() => loadConfig({ ...base, MEMORY_EXTRACT_MODE: 'on' })).toThrow(/MEMORY_EXTRACT_MODE/);
    expect(() => loadConfig({ ...base, MEMORY_EXTRACT_DAILY_MAX: '0' })).toThrow(ConfigError);
  });

  it('dsh mati bila DSH_COMMAND kosong; bila diisi, folder kerja wajib dan UID/GID berpasangan', () => {
    expect(loadConfig(base).DSH_COMMAND).toBeUndefined();
    expect(() => loadConfig({ ...base, DSH_COMMAND: '/usr/local/bin/dsh' })).toThrow(
      /DSH_WORKDIR_ROOT/,
    );
    const ok = { ...base, DSH_COMMAND: '/usr/local/bin/dsh', DSH_WORKDIR_ROOT: '/dsh/work' };
    expect(loadConfig(ok)).toMatchObject({
      DSH_ARGS: '--profile acp',
      DSH_MAX_MEMORY_MB: 2048,
      DSH_RUN_TIMEOUT_MS: 1_800_000,
    });
    expect(() => loadConfig({ ...ok, DSH_UID: '1001' })).toThrow(/DSH_GID/);
    expect(() => loadConfig({ ...ok, DSH_UID: '0', DSH_GID: '0' })).toThrow(ConfigError);
    expect(loadConfig({ ...ok, DSH_UID: '1001', DSH_GID: '1001' }).DSH_UID).toBe(1001);
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
