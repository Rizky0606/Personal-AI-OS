import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: here('..'), encoding: 'utf8' }).trim();

/**
 * Build aplikasi desktop untuk E2E: kode aplikasi yang sama, tetapi modul Tauri diganti shim (e2e/shims) yang
 * meneruskan HTTP, WebSocket, dan IPC ke server kendali Node. Cangkang Tauri (Rust) tidak ikut diuji.
 */
export default defineConfig({
  root: here('../apps/desktop'),
  plugins: [react(), tailwindcss()],
  // Alamat gateway E2E berubah tiap jalan, jadi selalu diketik di layar login (abaikan .env lokal).
  // Cap build (commit, waktu, kotor/tidak) ditanam supaya screenshot bisa dibuktikan berasal dari commit ini.
  define: {
    'import.meta.env.VITE_GATEWAY_URL': '""',
    __BUILD_COMMIT__: JSON.stringify(git('rev-parse', '--short', 'HEAD')),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 19) + 'Z'),
    __BUILD_DIRTY__: JSON.stringify(
      git(
        'status',
        '--porcelain',
        '--',
        '.',
        ':!docs/screenshots',
        ':!e2e/.stack.json',
        ':!e2e/test-results',
      ) !== '',
    ),
  },
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/core$/, replacement: here('shims/core.ts') },
      { find: /^@tauri-apps\/plugin-http$/, replacement: here('shims/http.ts') },
      { find: /^@tauri-apps\/plugin-websocket$/, replacement: here('shims/websocket.ts') },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: here('shims/dialog.ts') },
      { find: /^@tauri-apps\/plugin-opener$/, replacement: here('shims/opener.ts') },
      { find: /^@tauri-apps\/plugin-updater$/, replacement: here('shims/updater.ts') },
      { find: /^@tauri-apps\/api\/(event|window)$/, replacement: here('shims/quick.ts') },
      { find: /^@tauri-apps\/plugin-global-shortcut$/, replacement: here('shims/quick.ts') },
    ],
  },
  build: {
    target: 'es2023',
    outDir: here('../apps/desktop/dist-e2e'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
