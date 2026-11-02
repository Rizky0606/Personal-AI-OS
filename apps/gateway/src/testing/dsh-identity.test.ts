import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDshEngine, type DshDeps } from '../modules/dsh/launch.js';
import { DSH_TEST_ID, dshTestIdentity } from './dsh-identity.js';

const base = (identity: ReturnType<typeof dshTestIdentity>): DshDeps['config'] => ({
  DSH_COMMAND: process.execPath,
  DSH_ARGS: '',
  DSH_HOME: undefined,
  DSH_WORKDIR_ROOT: join(tmpdir(), 'dsh-uji'),
  DSH_MAX_MEMORY_MB: 512,
  DSH_RUN_TIMEOUT_MS: 60_000,
  DSH_IDLE_TIMEOUT_MS: 30_000,
  DSH_APPROVAL_TIMEOUT_MS: 30_000,
  NINEROUTER_API_KEY: 'k',
  ...identity,
});

describe('dshTestIdentity (tes dsh sebagai root)', () => {
  it('root: mengisi UID dan GID non-root', () => {
    expect(dshTestIdentity(0)).toEqual({ DSH_UID: DSH_TEST_ID, DSH_GID: DSH_TEST_ID });
    expect(DSH_TEST_ID).toBeGreaterThan(0);
  });

  it('bukan root atau tanpa getuid (Windows): dibiarkan kosong', () => {
    expect(dshTestIdentity(1000)).toEqual({ DSH_UID: undefined, DSH_GID: undefined });
    expect(dshTestIdentity(undefined)).toEqual({ DSH_UID: undefined, DSH_GID: undefined });
  });

  it('dengan identitas uji, gateway root diterima oleh peluncur produksi', () => {
    const engine = createDshEngine({ config: base(dshTestIdentity(0)), uid: 0 });
    expect(engine).toBeDefined();
    engine?.close();
  });

  it('pemeriksaan keamanan tidak dilonggarkan: gateway root tanpa DSH_UID tetap ditolak', () => {
    expect(() => createDshEngine({ config: base(dshTestIdentity(1000)), uid: 0 })).toThrow(/root/);
  });
});
