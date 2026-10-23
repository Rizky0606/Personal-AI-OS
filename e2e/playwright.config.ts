import { defineConfig } from '@playwright/test';

/**
 * E2E desktop: UI asli (build khusus dengan shim Tauri) melawan gateway, worker, dan omp nyata; layanan eksternal
 * (Hermes, 9Router, SearXNG) palsu. Memakai Edge/Chrome yang sudah terpasang, tidak mengunduh peramban.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './harness/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:1421',
    channel: process.env.E2E_BROWSER ?? 'msedge',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'pnpm --filter @aios/desktop exec vite preview --outDir dist-e2e --port 1421 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
