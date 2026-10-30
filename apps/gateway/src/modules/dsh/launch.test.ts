import { describe, expect, it } from 'vitest';
import { createDshEngine, dshEnv, dshEngineList, type DshDeps } from './launch.js';

const config = (over: Partial<DshDeps['config']> = {}): DshDeps['config'] => ({
  DSH_COMMAND: '/usr/local/bin/dsh',
  DSH_ARGS: '--profile acp',
  DSH_HOME: '/dsh/home',
  DSH_WORKDIR_ROOT: '/dsh/work',
  DSH_UID: undefined,
  DSH_GID: undefined,
  DSH_MAX_MEMORY_MB: 1024,
  DSH_RUN_TIMEOUT_MS: 60_000,
  DSH_IDLE_TIMEOUT_MS: 30_000,
  DSH_APPROVAL_TIMEOUT_MS: 30_000,
  NINEROUTER_API_KEY: 'kunci-rahasia',
  ...over,
});

describe('dshEnv', () => {
  it('tidak membawa rahasia gateway; hanya env minimal, kunci 9Router, dan batas memori', () => {
    const env = dshEnv(config(), {
      PATH: '/usr/bin',
      DATABASE_URL: 'postgres://rahasia',
      AUTH_SECRET: 'rahasia',
      HERMES_API_KEY: 'rahasia',
      HOME: '/home/node',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      DSH_HOME: '/dsh/home',
      HOME: '/dsh/home',
      DSH_LLM_API_KEY: 'kunci-rahasia',
      NODE_OPTIONS: '--max-old-space-size=1024',
    });
  });

  it('tanpa kunci 9Router: tidak ada DSH_LLM_API_KEY', () => {
    expect(dshEnv(config({ NINEROUTER_API_KEY: undefined }), {})).not.toHaveProperty(
      'DSH_LLM_API_KEY',
    );
  });
});

describe('createDshEngine', () => {
  it('tanpa DSH_COMMAND: engine tidak ada dan terdaftar sebagai tidak tersedia', () => {
    const engine = createDshEngine({ config: config({ DSH_COMMAND: undefined }) });
    expect(engine).toBeUndefined();
    expect(dshEngineList(engine)).toEqual([
      { id: 'dsh', label: 'DeepSeek Harness (dsh)', available: false, experimental: true },
    ]);
  });

  it('menolak berjalan sebagai root tanpa DSH_UID', () => {
    expect(() => createDshEngine({ config: config(), uid: 0 })).toThrow(/root/);
    expect(
      createDshEngine({ config: config({ DSH_UID: 1001, DSH_GID: 1001 }), uid: 0 }),
    ).toBeDefined();
    expect(createDshEngine({ config: config(), uid: 1000 })).toBeDefined();
  });

  it('akar folder kerja harus absolut', () => {
    expect(() =>
      createDshEngine({ config: config({ DSH_WORKDIR_ROOT: 'relatif' }), uid: 1000 }),
    ).toThrow(/absolut/);
  });
});
