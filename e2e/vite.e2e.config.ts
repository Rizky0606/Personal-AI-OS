import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Build aplikasi desktop untuk E2E: kode aplikasi yang sama, tetapi modul Tauri diganti shim (e2e/shims) yang
 * meneruskan HTTP, WebSocket, dan IPC ke server kendali Node. Cangkang Tauri (Rust) tidak ikut diuji.
 */
export default defineConfig({
  root: here('../apps/desktop'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/core$/, replacement: here('shims/core.ts') },
      { find: /^@tauri-apps\/plugin-http$/, replacement: here('shims/http.ts') },
      { find: /^@tauri-apps\/plugin-websocket$/, replacement: here('shims/websocket.ts') },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: here('shims/dialog.ts') },
      { find: /^@tauri-apps\/plugin-opener$/, replacement: here('shims/opener.ts') },
    ],
  },
  build: {
    target: 'es2023',
    outDir: here('../apps/desktop/dist-e2e'),
    emptyOutDir: true,
    sourcemap: false,
  },
});
