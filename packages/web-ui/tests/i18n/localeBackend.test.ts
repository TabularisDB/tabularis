import {describe, expect, it} from 'vitest';
import {createInstance} from 'i18next';
import {localeBackend} from '@/i18n/localeBackend';
import en from '@/i18n/locales/en.json';
import itLocale from '@/i18n/locales/it.json';
import tl from '@/i18n/locales/tl.json';
import ptBR from '@/i18n/locales/pt-BR.json';
import vi from '@/i18n/locales/vi.json';

describe('bundled locale backend', () => {
    it('loads selected languages and Filipino aliases while retaining English fallback', async () => {
        const i18n = createInstance();
        await i18n.use(localeBackend).init({
            lng: 'en',
            fallbackLng: 'en',
            resources: {en: {translation: en}},
            partialBundledLanguages: true,
        });
        expect(i18n.hasResourceBundle('it', 'translation')).toBe(false);
        for (const [language, dictionary] of [
            ['it', itLocale],
            ['fil', tl],
            ['pt-BR', ptBR],
            ['vi-VN', vi],
        ] as const) {
            await i18n.changeLanguage(language);
            expect(i18n.t('common.cancel')).toBe(dictionary.common.cancel);
        }
        await i18n.changeLanguage('unknown');
        expect(i18n.t('common.cancel')).toBe(en.common.cancel);
    });
});
