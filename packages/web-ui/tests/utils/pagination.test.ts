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
import zh from '@/i18n/locales/zh.json';
import {
    PAGE_INPUT_SLOT,
    resolvePageJump,
    splitAroundPageSlot,
    totalPageCount,
} from '@/utils/pagination';

const locales = {de, en, es, fr, it: itLocale, ja, ko, 'pt-BR': ptBR, ru, tl, zh};

describe('totalPageCount', () => {
    it('returns null when the total row count is unknown', () => {
        expect(totalPageCount(null, 100)).toBeNull();
    });

    it('returns null when the page size cannot produce a count', () => {
        expect(totalPageCount(10, 0)).toBeNull();
        expect(totalPageCount(10, -5)).toBeNull();
        expect(totalPageCount(-1, 100)).toBeNull();
    });

    it('rounds partial pages up and treats an empty result as zero pages', () => {
        expect(totalPageCount(0, 100)).toBe(0);
        expect(totalPageCount(1, 100)).toBe(1);
        expect(totalPageCount(100, 100)).toBe(1);
        expect(totalPageCount(101, 100)).toBe(2);
        expect(totalPageCount(12000, 100)).toBe(120);
    });
});

describe('resolvePageJump', () => {
    describe('when the total is known', () => {
        it('accepts a page inside the range', () => {
            expect(resolvePageJump('40', 120)).toBe(40);
            expect(resolvePageJump('1', 120)).toBe(1);
            expect(resolvePageJump('120', 120)).toBe(120);
        });

        it('ignores surrounding whitespace and leading zeros', () => {
            expect(resolvePageJump('  40  ', 120)).toBe(40);
            expect(resolvePageJump('040', 120)).toBe(40);
            expect(resolvePageJump('+40', 120)).toBe(40);
        });

        it('clamps values below 1 up to the first page', () => {
            expect(resolvePageJump('0', 120)).toBe(1);
            expect(resolvePageJump('000', 120)).toBe(1);
            expect(resolvePageJump('-4', 120)).toBe(1);
            expect(resolvePageJump('+0', 120)).toBe(1);
        });

        it('clamps values above the last page', () => {
            expect(resolvePageJump('121', 120)).toBe(120);
            expect(resolvePageJump('999', 120)).toBe(120);
        });

        it('clamps an integer too large to represent exactly', () => {
            expect(resolvePageJump('9999999999999999999', 120)).toBe(120);
            expect(resolvePageJump('-9999999999999999999', 120)).toBe(1);
        });

        it('reverts when the typed text is not an integer', () => {
            expect(resolvePageJump('', 120)).toBeNull();
            expect(resolvePageJump('   ', 120)).toBeNull();
            expect(resolvePageJump('abc', 120)).toBeNull();
            expect(resolvePageJump('12abc', 120)).toBeNull();
            expect(resolvePageJump('1.5', 120)).toBeNull();
            expect(resolvePageJump('1e2', 120)).toBeNull();
            expect(resolvePageJump('+', 120)).toBeNull();
            expect(resolvePageJump('-', 120)).toBeNull();
            expect(resolvePageJump('4 0', 120)).toBeNull();
        });

        it('reverts when no positive page exists', () => {
            expect(resolvePageJump('1', 0)).toBeNull();
            expect(resolvePageJump('3', -1)).toBeNull();
        });
    });

    describe('when the total is unknown', () => {
        it('accepts any positive integer', () => {
            expect(resolvePageJump('1', null)).toBe(1);
            expect(resolvePageJump('80', null)).toBe(80);
            expect(resolvePageJump('  7 ', null)).toBe(7);
        });

        it('reverts non-positive integers and invalid text', () => {
            expect(resolvePageJump('0', null)).toBeNull();
            expect(resolvePageJump('-3', null)).toBeNull();
            expect(resolvePageJump('', null)).toBeNull();
            expect(resolvePageJump('abc', null)).toBeNull();
            expect(resolvePageJump('1.5', null)).toBeNull();
            expect(resolvePageJump('9999999999999999999', null)).toBeNull();
        });
    });
});

describe('page indicator copy', () => {
    it('splits a translated label around the current page', () => {
        const label = en.editor.pageOf
            .replace('{{current}}', PAGE_INPUT_SLOT)
            .replace('{{total}}', '120');
        expect(splitAroundPageSlot(label)).toEqual({before: 'Page ', after: ' of 120'});
        expect(
            splitAroundPageSlot(
                ko.editor.pageOf
                    .replace('{{current}}', PAGE_INPUT_SLOT)
                    .replace('{{total}}', '120'),
            ),
        ).toEqual({before: '120페이지 중 ', after: ''});
        expect(
            splitAroundPageSlot(
                ja.editor.pageOf
                    .replace('{{current}}', PAGE_INPUT_SLOT)
                    .replace('{{total}}', '120'),
            ),
        ).toEqual({before: '', after: ' / 120 ページ'});
        expect(splitAroundPageSlot('no marker')).toBeNull();
    });

    it('keeps the current-page slot in every locale and translates the input name', () => {
        for (const [code, locale] of Object.entries(locales)) {
            expect(locale.editor.page.match(/\{\{current\}\}/g), code).toEqual(['{{current}}']);
            expect(locale.editor.pageOf.match(/\{\{current\}\}/g), code).toEqual(['{{current}}']);
            expect(locale.editor.pageOf, code).toContain('{{total}}');

            const pageNumber = locale.pagination.pageNumber;
            expect(pageNumber.trim(), code).not.toBe('');
            if (code !== 'en') {
                expect(pageNumber, code).not.toBe(en.pagination.pageNumber);
            }

            const withSlot = locale.editor.pageOf
                .replace('{{current}}', PAGE_INPUT_SLOT)
                .replace('{{total}}', '8');
            const parts = splitAroundPageSlot(withSlot);
            expect(parts, code).not.toBeNull();
            expect(parts?.before.includes(PAGE_INPUT_SLOT), code).toBe(false);
            expect(parts?.after.includes(PAGE_INPUT_SLOT), code).toBe(false);
        }
    });
});
