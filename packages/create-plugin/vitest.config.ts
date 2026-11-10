import path from 'node:path';
import {defineConfig} from 'vitest/config';

export default defineConfig({
    resolve: {
        // Theme helpers are shared with the app (packages/web-ui/src/), which imports through '@/'.
        alias: {'@': path.resolve(__dirname, '../web-ui/src')},
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
