import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

/**
 * Renderer-only Vite config for visual QA / screenshots without Electron.
 * Usage: npx vite --config vite.preview.config.ts --host 127.0.0.1 --port 5173
 */
export default defineConfig({
  base: './',
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer')
    }
  },
  root: 'src/renderer',
  publicDir: path.resolve(__dirname, 'public'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-preview'),
    emptyOutDir: true
  }
});
