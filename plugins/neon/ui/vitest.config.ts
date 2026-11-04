import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

export default defineConfig({
    // The plugin externalizes React to the host; hook tests use the host renderer too.
    resolve: {
        alias: {
            react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)),
            '@': fileURLToPath(new URL('../../../packages/web-ui/src', import.meta.url)),
        },
    },
    test: {environment: 'node', include: ['tests/**/*.test.ts']},
});
