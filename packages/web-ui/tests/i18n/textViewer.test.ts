import {describe, expect, it} from 'vitest';
import en from '@/i18n/locales/en.json';

const locales = import.meta.glob<{default: typeof en}>('../../src/i18n/locales/*.json', {
    eager: true,
});

describe('text viewer translations', () => {
    it.each(Object.entries(locales))('defines the wrap toggle in %s', (_path, locale) => {
        const wrapLines = locale.default.textViewer?.wrapLines;

        expect(typeof wrapLines).toBe('string');
        expect(wrapLines?.trim()).not.toBe('');
    });
});
