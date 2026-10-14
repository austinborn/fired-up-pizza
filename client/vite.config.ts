import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The API runs on its own port; the dev server proxies /api to it so the
// client always calls same-origin relative URLs (ADR 0001, ADR 0007).
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': apiTarget },
  },
  test: {
    name: 'client',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
