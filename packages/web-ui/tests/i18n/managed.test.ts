import {describe, expect, it} from 'vitest';
import en from '../../src/i18n/locales/en.json';

const locales = import.meta.glob<{default: typeof en}>('../../src/i18n/locales/*.json', {
    eager: true,
});

const keys = Object.keys(en.managed) as (keyof typeof en.managed)[];
const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();

describe('managed connection translations', () => {
    it('defines the strings the Web UI uses', () => {
        expect(keys.sort()).toEqual(['denied', 'noConnections', 'notice', 'noticeTitle']);
    });

    it.each(Object.entries(locales))('covers every managed-mode string in %s', (_path, locale) => {
        const managed = (locale.default as {managed?: Record<string, string>}).managed;
        expect(managed, 'the locale has no managed section').toBeDefined();
        expect(Object.keys(managed ?? {}).sort()).toEqual([...keys].sort());
        for (const key of keys) {
            expect(managed?.[key]?.trim(), key).toBeTruthy();
            expect(placeholders(managed?.[key] ?? ''), key).toEqual(placeholders(en.managed[key]));
        }
    });

    it('translates the sentences rather than copying English into other locales', () => {
        for (const [path, locale] of Object.entries(locales)) {
            if (path.endsWith('/en.json')) continue;
            expect(locale.default.managed.noticeTitle, path).not.toBe(en.managed.noticeTitle);
        }
    });
});
