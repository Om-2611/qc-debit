import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin /api in dev, so the httpOnly refresh cookie (SameSite=Strict) just works.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: a change to app code does not make users re-download MUI or the charts.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@emotion/react', '@emotion/styled'],
          charts: ['recharts'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod', '@tanstack/react-query'],
        },
      },
    },
  },
});
