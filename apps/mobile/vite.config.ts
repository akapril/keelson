import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const workspace = fileURLToPath(new URL('../..', import.meta.url));
const host = process.env.TAURI_DEV_HOST;
export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: { '/src': fileURLToPath(new URL('../../src', import.meta.url)) } },
  clearScreen: false,
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: host || '127.0.0.1', port: 1430, strictPort: true,
    fs: { allow: [workspace] },
    hmr: host ? { protocol: 'ws', host, port: 1431 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
