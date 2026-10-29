import fs from 'node:fs';
import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import {defineConfig, globalIgnores} from 'eslint/config';

const tauriBoundaryAllowlist = JSON.parse(
    fs.readFileSync(
        new URL('./scripts/web/web-ui-tauri-boundary-allowlist.json', import.meta.url),
        'utf8',
    ),
);
const tauriImportExceptions = [
    ...tauriBoundaryAllowlist.adapterFiles,
    ...Object.keys(tauriBoundaryAllowlist.legacyTauriImports),
];

export default defineConfig([
    globalIgnores([
        'dist',
        'packages/create-plugin/dist',
        'packages/web-ui/tests',
        'tests',
        // The native macOS suite under e2e/ has its own toolchain; the browser
        // matrix under e2e/web/ is linted with the workspace.
        'e2e/*',
        '!e2e/web',
        'e2e/web/.runtime',
        'coverage',
        'src-tauri/target/**',
    ]),
    {
        files: ['**/*.{ts,tsx}'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@tauri-apps/**'],
                            message:
                                'Use a frontend transport or platform adapter instead of importing Tauri directly.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['e2e/web/**/*.ts'],
        languageOptions: {
            globals: {...globals.browser, ...globals.node},
        },
    },
    {
        files: ['packages/web-ui/src/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@tauri-apps/**'],
                            message:
                                'Use a frontend transport or platform adapter instead of importing Tauri directly.',
                        },
                        {group: ['../*'], message: "Import through '@/' instead of '../'."},
                    ],
                },
            ],
        },
    },
    {
        files: tauriImportExceptions,
        rules: {
            'no-restricted-imports': 'off',
        },
    },
    {
        files: ['**/*.tsx'],
        extends: [jsxA11y.flatConfigs.recommended],
        rules: {
            // Modals focus their primary field on open (see .rules/modals.md).
            'jsx-a11y/no-autofocus': 'off',
        },
    },
]);
