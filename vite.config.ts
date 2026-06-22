import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { lingui } from '@lingui/vite-plugin'
import { linguiWatch } from './scripts/i18n/vite-lingui-watch.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
    lingui(),
    // Dev-only: regenerate message catalogs on source change (no extra process).
    linguiWatch(),
  ],
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
        manualChunks: {
          'monaco-editor': ['monaco-editor', '@monaco-editor/react'],
          recharts: ['recharts'],
          xyflow: ['@xyflow/react', 'dagre'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          i18n: ['@lingui/core', '@lingui/react'],
          markdown: ['react-markdown'],
          table: ['@tanstack/react-table', '@tanstack/react-virtual'],
          wkx: ['wkx', 'buffer', 'util'],
        },
      },
    },
  },
})
