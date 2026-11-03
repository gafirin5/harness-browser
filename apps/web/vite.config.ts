import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7788', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:7788', ws: true }
    }
  },
  build: {
    target: ['chrome93'],
    cssTarget: 'chrome93',
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          xterm: ['@xterm/xterm', '@xterm/addon-fit']
        }
      }
    }
  }
});