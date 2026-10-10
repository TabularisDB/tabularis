/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceRoot = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@': sourceRoot,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./packages/web-ui/tests/setup.ts'],
    include: [
      'packages/web-ui/src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'packages/web-ui/tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      // Other workspace packages (packages/*) run their own vitest with a node
      // environment via `pnpm --filter <pkg> test` (see packages.yml). They are
      // deliberately not included here: the jsdom environment breaks Node-only
      // tests (Vite rewrites `new URL(x, import.meta.url)` against location).
      // Web UI project tooling tests live with the tracked migration process.
      'web-ui-project/tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/web-ui/src/**/*.ts', 'packages/web-ui/src/**/*.tsx'],
      exclude: [
        'packages/web-ui/src/**/*.test.ts',
        'packages/web-ui/src/**/*.d.ts',
        'packages/web-ui/src/test/**',
      ],
    },
  },
});
