import path from 'node:path';
import {defineConfig} from 'vitest/config';
import {generateThemeSchemaValidators} from '../../scripts/generate-theme-schema-validators';

const appSrc = path.resolve(__dirname, '../web-ui/src');
generateThemeSchemaValidators(appSrc);

export default defineConfig({
    resolve: {
        // Theme helpers are shared with the app (packages/web-ui/src/), which imports through '@/'.
        alias: {'@': appSrc},
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
