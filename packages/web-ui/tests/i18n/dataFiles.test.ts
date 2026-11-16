import {describe, expect, it} from 'vitest';
import en from '../../src/i18n/locales/en.json';

const locales = import.meta.glob<{default: typeof en}>('../../src/i18n/locales/*.json', {
    eager: true,
});

const keys = Object.keys(en.dataFiles) as (keyof typeof en.dataFiles)[];
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

describe('data file translations', () => {
    it.each(Object.entries(locales))('covers every data file string in %s', (_path, locale) => {
        const dataFiles = locale.default.dataFiles as Record<string, string>;
        expect(Object.keys(dataFiles).sort()).toEqual([...keys].sort());
        for (const key of keys) {
            expect(dataFiles[key]?.trim(), key).toBeTruthy();
            expect(placeholders(dataFiles[key]), key).toEqual(placeholders(en.dataFiles[key]));
        }
    });
});
