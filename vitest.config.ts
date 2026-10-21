/// <reference types="vitest" />
import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        include: [
            'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
            // Workspace packages (packages/*) run their own vitest with a node
            // environment via `pnpm --filter <pkg> test` (see packages.yml). They are
            // deliberately not included here: the jsdom environment breaks Node-only
            // tests (Vite rewrites `new URL(x, import.meta.url)` against location).
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts', 'src/**/*.tsx'],
            exclude: ['src/**/*.d.ts'],
        },
    },
});
