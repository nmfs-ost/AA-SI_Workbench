import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal local declaration so vite.config (which runs in Node) can read an
// env var without pulling in @types/node for the whole project.
declare const process: { env: Record<string, string | undefined> };

// https://vitejs.dev/config/
// `server.host` is enabled so the dev server is reachable from the browser
// running on a Google Cloud Workstation (i.e. not just localhost).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    // Forward API calls to the backend during development so the browser can
    // hit same-origin `/api/...` (no CORS). Override the target with
    // VITE_AASI_API_PROXY if the backend runs elsewhere.
    proxy: {
      '/api': {
        target: process.env.VITE_AASI_API_PROXY || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
  },
});
