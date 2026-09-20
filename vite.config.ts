import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    react(),
    electron([
      {
        entry: path.resolve(__dirname, 'src/main/index.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            rollupOptions: {
              external: [
                'better-sqlite3',
                'ffmpeg-static',
                'express',
                'socket.io',
                'qrcode',
                'onnxruntime-web',
                'onnxruntime-web/all',
                'demucs-web',
                'fft.js'
              ]
            }
          }
        }
      },
      {
        // Utility-process entry for Download Instrumental AI (ORT off Control UI)
        entry: path.resolve(__dirname, 'src/main/workers/instrumentalAiWorker.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            emptyOutDir: false,
            rollupOptions: {
              output: {
                entryFileNames: 'instrumentalAiWorker.js',
                banner: "if (typeof globalThis.location === 'undefined') { globalThis.location = new URL('file:///'); }\n"
              },
              external: [
                'onnxruntime-web',
                'onnxruntime-web/all',
                'demucs-web',
                'fft.js',
                'electron'
              ]
            }
          }
        }
      },
      {
        // Hidden BrowserWindow entry — real navigator.gpu / ORT WebGPU EP
        entry: path.resolve(__dirname, 'src/main/workers/instrumentalAiGpuRenderer.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            emptyOutDir: false,
            rollupOptions: {
              output: {
                entryFileNames: 'instrumentalAiGpuRenderer.js'
              },
              external: [
                'onnxruntime-web',
                'onnxruntime-web/all',
                'demucs-web',
                'fft.js',
                'electron'
              ]
            }
          }
        }
      },
      {
        entry: path.resolve(__dirname, 'src/preload/index.ts'),
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/preload')
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer')
    }
  },
  root: 'src/renderer',
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
});
