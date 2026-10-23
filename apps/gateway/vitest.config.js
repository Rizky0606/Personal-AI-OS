import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Menyiapkan Postgres 16 untuk tes integrasi (atau memakai TEST_DATABASE_URL).
    globalSetup: ['./src/testing/global-setup.ts'],
    // Tes integrasi membuat database, men-hash password (argon2), dan menyalakan pg-boss; di mesin yang sedang
    // sibuk satu tes bisa memakan puluhan detik.
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
