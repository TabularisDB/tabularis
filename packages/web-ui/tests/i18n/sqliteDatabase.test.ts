import {describe, expect, it} from 'vitest';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import es from '@/i18n/locales/es.json';
import fr from '@/i18n/locales/fr.json';
import itLocale from '@/i18n/locales/it.json';
import ja from '@/i18n/locales/ja.json';
import ko from '@/i18n/locales/ko.json';
import ru from '@/i18n/locales/ru.json';
import tl from '@/i18n/locales/tl.json';
import zh from '@/i18n/locales/zh.json';

const locales = {de, en, es, fr, it: itLocale, ja, ko, ru, tl, zh};

describe('SQLite database creation translations', () => {
    it('defines every required string in each supported locale', () => {
        for (const translation of Object.values(locales)) {
            expect(translation.connections.newSqliteDatabase.menuLabel).toBeTruthy();
            expect(translation.connections.newSqliteDatabase.dialogTitle).toBeTruthy();
            expect(translation.connections.newSqliteDatabase.fileType).toBeTruthy();
            expect(translation.connections.newSqliteDatabase.error).toBeTruthy();
        }
    });
});
