import {fileURLToPath} from 'node:url';

import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

import {normalizeWebBasePath} from './src/utils/webBasePath';
import {generateThemeSchemaValidators} from '../../scripts/generate-theme-schema-validators';

const webUiRoot = fileURLToPath(new URL('.', import.meta.url));
generateThemeSchemaValidators(fileURLToPath(new URL('./src', import.meta.url)));

const buildBasePath = normalizeWebBasePath(process.env.TABULARIS_BASE_PATH);

export default defineConfig({
    appType: 'spa',
    base: buildBasePath === '/' ? './' : buildBasePath,
    plugins: [
        react(),
        {
            name: 'tabularis-build-base',
            transformIndexHtml() {
                return [
                    {
                        tag: 'meta',
                        attrs: {name: 'tabularis-build-base', content: buildBasePath},
                        injectTo: 'head-prepend' as const,
                    },
                ];
            },
        },
    ],
    css: {
        postcss: webUiRoot,
    },
    server: {watch: {ignored: ['**/src-tauri/**']}},
    // Discover lazy UI dependencies before WebViews cache their optimized import URLs.
    optimizeDeps: {
        entries: ['index.html', 'src/**/*.tsx'],
        include: [
            'react-colorful',
            'emoji-picker-react',
            '@tanstack/react-table',
            '@tanstack/react-virtual',
        ],
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            // Polyfills for browser environment (needed by wkx library)
            buffer: 'buffer',
            util: 'util',
        },
    },
    define: {
        'import.meta.env.BASE_URL': JSON.stringify(buildBasePath),
        // Make Node.js globals available in browser
        global: 'globalThis',
        'process.env': {},
    },
    build: {
        // Monaco editor ships pre-built web workers (ts.worker ~7MB, css.worker ~1MB)
        // that are loaded lazily on demand — bumping the limit accommodates them.
        chunkSizeWarningLimit: 8000,
        // Nightly builds set TABULARIS_SOURCEMAP so bug reports carry readable stack traces.
        sourcemap: process.env.TABULARIS_SOURCEMAP === 'true',
        rollupOptions: {
            output: {
                // Shared React dependencies must not be absorbed by the editor chunk.
                onlyExplicitManualChunks: true,
                manualChunks(id) {
                    // Vite/CommonJS helpers are shared by eager and lazy modules. Putting
                    // them in Monaco would turn its dynamic import into a static one.
                    if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers'))
                        return 'runtime';
                },
            },
        },
    },
});
