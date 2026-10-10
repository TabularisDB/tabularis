import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { WEB_UI_BASE_PATH } from './src/routing'

const webUiRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  appType: 'spa',
  base: WEB_UI_BASE_PATH,
  plugins: [react()],
  css: {
    postcss: webUiRoot,
  },
  resolve: {
    alias: {
      // Polyfills for browser environment (needed by wkx library)
      buffer: 'buffer',
      util: 'util',
    },
  },
  define: {
    // Make Node.js globals available in browser
    global: 'globalThis',
    'process.env': {},
  },
  build: {
    // Monaco editor ships pre-built web workers (ts.worker ~7MB, css.worker ~1MB)
    // that are loaded lazily on demand — bumping the limit accommodates them.
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        // Shared React dependencies must not be absorbed by the editor chunk.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          // Vite/CommonJS helpers are shared by eager and lazy modules. Putting
          // them in Monaco would turn its dynamic import into a static one.
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'runtime';
        },
      },
    },
  },
})
