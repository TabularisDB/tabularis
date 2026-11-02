import {describe, expect, it} from 'vitest';

import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';
import fr from '@/i18n/locales/fr.json';
import itLocale from '@/i18n/locales/it.json';
import ja from '@/i18n/locales/ja.json';
import ko from '@/i18n/locales/ko.json';
import ptBR from '@/i18n/locales/pt-BR.json';
import ru from '@/i18n/locales/ru.json';
import tl from '@/i18n/locales/tl.json';
import vi from '@/i18n/locales/vi.json';
import zh from '@/i18n/locales/zh.json';

const locales = {
    de,
    en,
    es,
    fr,
    it: itLocale,
    ja,
    ko,
    'pt-BR': ptBR,
    ru,
    tl,
    vi,
    zh,
};

const assertTranslation = (locale: string, key: string, value: unknown, englishValue: string) => {
    expect(typeof value, `${locale} ${key}`).toBe('string');
    expect((value as string).trim(), `${locale} ${key}`).not.toBe('');
    if (locale !== 'en') {
        expect(value, `${locale} ${key} uses the English fallback`).not.toBe(englishValue);
    }
};

describe('command palette result translations', () => {
    it('defines every result command label in every locale', () => {
        for (const [locale, translation] of Object.entries(locales)) {
            const resultLabels = {
                'dataGrid.copyCells': translation.dataGrid.copyCells,
                'dataGrid.copyRows': translation.dataGrid.copyRows,
                'dataGrid.copySelectedColumns': translation.dataGrid.copySelectedColumns,
                'dataGrid.copyColumnValuesIn': translation.dataGrid.copyColumnValuesIn,
                'dataGrid.copyAll': translation.dataGrid.copyAll,
                'dataGrid.copyAllRows': translation.dataGrid.copyAllRows,
                'editor.multiResult.results': translation.editor.multiResult.results,
            };

            for (const [key, value] of Object.entries(resultLabels)) {
                const [section, ...path] = key.split('.');
                const englishValue = path.reduce<unknown>(
                    (current, segment) => (current as Record<string, unknown>)[segment],
                    en[section as keyof typeof en],
                );
                assertTranslation(locale, key, value, englishValue as string);
            }
        }
    });
});
