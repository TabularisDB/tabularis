import {describe, expect, it} from 'vitest';
import en from '@/i18n/locales/en.json';

const locales = import.meta.glob('@/i18n/locales/*.json', {eager: true, import: 'default'});

describe('notebook execution translations', () => {
    it('checks all 13 catalogs', () => {
        expect(
            Object.keys(locales)
                .map((path) => path.split('/').at(-1))
                .sort(),
        ).toEqual(
            ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tl', 'vi', 'zh-TW', 'zh']
                .map((locale) => `${locale}.json`)
                .sort(),
        );
    });

    it.each(Object.entries(locales))(
        'defines every message and interpolation token in %s',
        (_file, catalog) => {
            const {notebook} = (catalog as typeof en).editor;
            for (const [key, template] of Object.entries(en.editor.notebook.execution)) {
                const message = notebook.execution[key as keyof typeof notebook.execution];
                expect(message, key).toBeTypeOf('string');
                expect(message.trim(), key).not.toBe('');
                expect(message.match(/\{\{\w+\}\}/g)?.sort() ?? [], key).toEqual(
                    template.match(/\{\{\w+\}\}/g)?.sort() ?? [],
                );
            }
            for (const key of [
                'runAllTooltip',
                'stopOnErrorTooltip',
                'parallelExecution',
            ] as const) {
                expect(notebook[key].trim(), key).not.toBe('');
            }
        },
    );
});
