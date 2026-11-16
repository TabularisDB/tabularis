import {readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

interface NotebookLocale {
    editor: {
        notebook: Record<string, string>;
    };
}

const localesDirectory = resolve(__dirname, '../../src/i18n/locales');
const localeFiles = readdirSync(localesDirectory)
    .filter((file) => file.endsWith('.json'))
    .sort();
const clearOutputsKeys = ['clearOutputs', 'clearOutputsConfirm'] as const;

describe('notebook clear outputs translations', () => {
    describe.each(localeFiles)('%s', (file) => {
        const translation = JSON.parse(
            readFileSync(resolve(localesDirectory, file), 'utf8'),
        ) as NotebookLocale;

        it.each(clearOutputsKeys)('defines %s', (key) => {
            const value = translation.editor.notebook[key];
            expect(value).toBeTypeOf('string');
            expect(value.trim()).not.toBe('');
        });
    });
});
