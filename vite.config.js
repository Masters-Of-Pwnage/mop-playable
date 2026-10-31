import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// https://vite.dev/config/
// BASE_PATH lets the same build be hosted at the site root (own server) or under
// /mop-playable/ (GitHub Pages, the default, as in the original project).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  base: process.env.BASE_PATH ?? '/mop-playable/',
  // Dev: the API and the login callback live on the game server (npm run server, port 8787).
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
