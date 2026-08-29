import path from 'path';
import { config as loadDotenv } from 'dotenv';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { autowiniPhotoProxyPlugin } from './autowini-photo-proxy';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');
loadDotenv({ path: path.join(workspaceRoot, '.env') });

const rawPort = process.env.DASHBOARD_PORT;
const port = rawPort && !Number.isNaN(Number(rawPort)) ? Number(rawPort) : 3000;

const basePath = process.env.BASE_PATH ?? "/adminz/";
const apiUrl = process.env.API_URL ?? 'http://localhost:5000';

const replitPlugins =
  process.env.NODE_ENV !== 'production' && process.env.REPL_ID !== undefined
    ? [
        (await import('@replit/vite-plugin-cartographer')).cartographer({
          root: path.resolve(import.meta.dirname, '..'),
        }),
        (await import('@replit/vite-plugin-dev-banner')).devBanner(),
      ]
    : [];

export default defineConfig({
  base: basePath,
  plugins: [
    autowiniPhotoProxyPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...replitPlugins,
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      '/api': {
        target: apiUrl,
        changeOrigin: true,
        xfwd: true,
        timeout: 20_000,
        proxyTimeout: 20_000,
      },
      '/docs': {
        target: apiUrl,
        changeOrigin: true,
        xfwd: true,
        timeout: 20_000,
        proxyTimeout: 20_000,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiUrl,
        changeOrigin: true,
        xfwd: true,
        timeout: 20_000,
        proxyTimeout: 20_000,
      },
      '/docs': {
        target: apiUrl,
        changeOrigin: true,
        xfwd: true,
        timeout: 20_000,
        proxyTimeout: 20_000,
      },
    },
  },
});
