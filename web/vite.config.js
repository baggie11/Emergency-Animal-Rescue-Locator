import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Dev-only: keeps the frontend on same-origin /api so no CORS in the hot loop.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    // Emergency tool: fail loudly rather than shipping an oversized bundle.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Leaflet is the only heavy dep; splitting it keeps the first paint fast.
        manualChunks: { leaflet: ['leaflet'] },
      },
    },
  },
});
