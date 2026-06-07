import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  // Support WASM file type for AI engine integration
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
