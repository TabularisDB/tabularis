import {describe, it, expect} from 'vitest';
import {getAiExplanationLanguage, resolveAutoLanguage} from '@/i18n/language';
import {SUPPORTED_LANGUAGES} from '@/i18n/config';

describe('language', () => {
    describe('resolveAutoLanguage', () => {
        it('resolves a regional locale to its base language', () => {
            expect(resolveAutoLanguage('it-IT')).toBe('it');
        });

        it('keeps a supported regional locale', () => {
            expect(resolveAutoLanguage('pt-BR')).toBe('pt-BR');
        });

        it('falls back to English for unsupported locales', () => {
            expect(resolveAutoLanguage('xx-YY')).toBe('en');
        });

        it('is case- and separator-insensitive', () => {
            expect(resolveAutoLanguage('PT_br')).toBe('pt-BR');
            expect(resolveAutoLanguage('ZH-cn')).toBe('zh');
        });

        it('maps a Filipino system locale to Tagalog', () => {
            expect(resolveAutoLanguage('fil-PH')).toBe('tl');
            expect(resolveAutoLanguage('fil')).toBe('tl');
        });

        it('maps a Vietnamese system locale to Vietnamese', () => {
            expect(resolveAutoLanguage('vi-VN')).toBe('vi');
            expect(resolveAutoLanguage('vi')).toBe('vi');
        });

        it('picks the first supported locale from a preference list', () => {
            expect(resolveAutoLanguage(['xx-YY', 'de-DE', 'it'])).toBe('de');
        });

        it('falls back to English for an empty or missing input', () => {
            expect(resolveAutoLanguage()).toBe('en');
            expect(resolveAutoLanguage([])).toBe('en');
            expect(resolveAutoLanguage(null)).toBe('en');
            expect(resolveAutoLanguage('')).toBe('en');
        });
    });

    describe('getAiExplanationLanguage', () => {
        it('uses the resolved language in auto mode', () => {
            expect(getAiExplanationLanguage('auto', 'it')).toBe('Italiano');
        });

        it('names Tagalog for a Filipino locale in auto mode', () => {
            expect(getAiExplanationLanguage('auto', 'fil')).toBe('Tagalog');
        });

        it('maps supported regional locales in auto mode', () => {
            expect(getAiExplanationLanguage('auto', 'pt-BR')).toBe('Português (Brasil)');
            expect(getAiExplanationLanguage('auto', 'zh-CN')).toBe('中文');
            expect(getAiExplanationLanguage('auto', 'it-CH')).toBe('Italiano');
            expect(getAiExplanationLanguage('auto', 'vi-VN')).toBe('Tiếng Việt');
        });

        it('is case- and separator-insensitive', () => {
            expect(getAiExplanationLanguage('auto', 'PT_br')).toBe('Português (Brasil)');
        });

        it('falls back to English for unsupported resolved languages', () => {
            expect(getAiExplanationLanguage('auto', 'nl')).toBe('English');
            expect(getAiExplanationLanguage('auto', 'sv-SE')).toBe('English');
        });

        it('falls back to English when the resolved language is missing', () => {
            expect(getAiExplanationLanguage('auto')).toBe('English');
            expect(getAiExplanationLanguage('auto', undefined)).toBe('English');
            expect(getAiExplanationLanguage('auto', '')).toBe('English');
        });

        it('keeps explicitly selected languages unchanged', () => {
            for (const {id, label} of SUPPORTED_LANGUAGES) {
                expect(getAiExplanationLanguage(id)).toBe(label);
            }
            expect(getAiExplanationLanguage('it', 'de')).toBe('Italiano');
        });
    });
});
