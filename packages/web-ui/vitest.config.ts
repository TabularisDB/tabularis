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
      // Workspace packages keep their tests next to their own source.
      'packages/*/tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      // Repository tooling tests remain outside the frontend package.
      'tests/scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
      exclude: [
        'packages/web-ui/src/**/*.test.ts',
        'packages/web-ui/src/**/*.d.ts',
        'packages/web-ui/src/test/**',
      ],
    },
  },
});
