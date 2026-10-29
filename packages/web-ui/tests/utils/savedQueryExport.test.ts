import {describe, it, expect} from 'vitest';
import {formatSavedQueriesAsSql} from '@/utils/savedQueryExport';
import type {SavedQuery, SavedQueryFolder} from '@/contexts/SavedQueriesContext';

const makeQuery = (overrides: Partial<SavedQuery>): SavedQuery => ({
    id: 'q1',
    name: 'Query',
    sql: 'SELECT 1',
    connection_id: 'c1',
    database: null,
    created_at: null,
    updated_at: null,
    ...overrides,
});

const folders = [{id: 'f1', name: 'Reports'}] as SavedQueryFolder[];

describe('savedQueryExport', () => {
    describe('formatSavedQueriesAsSql', () => {
        it('returns an empty string for no queries', () => {
            expect(formatSavedQueriesAsSql([], folders)).toBe('');
        });

        it('writes name and folder headers followed by terminated SQL', () => {
            const out = formatSavedQueriesAsSql(
                [
                    makeQuery({name: 'A', sql: 'SELECT 1', folder_id: 'f1'}),
                    makeQuery({name: 'B', sql: 'SELECT 2;'}),
                ],
                folders,
            );
            expect(out).toBe(
                '-- Name: A\n-- Folder: Reports\nSELECT 1;\n\n-- Name: B\nSELECT 2;\n',
            );
        });

        it('omits the folder line for unknown folders', () => {
            const out = formatSavedQueriesAsSql([makeQuery({folder_id: 'gone'})], folders);
            expect(out).not.toContain('-- Folder');
        });

        it('keeps names with line breaks on a single comment line', () => {
            const out = formatSavedQueriesAsSql(
                [makeQuery({name: 'x\n DROP TABLE t; --\r\ny'})],
                folders,
            );
            expect(out.split('\n')[0]).toBe('-- Name: x DROP TABLE t; -- y');
            expect(out.split('\n')).toHaveLength(3);
        });

        it('keeps comment markers inside the header comment', () => {
            const out = formatSavedQueriesAsSql([makeQuery({name: '*/ -- /*'})], folders);
            expect(out.startsWith('-- Name: */ -- /*\nSELECT 1;')).toBe(true);
        });

        it('falls back when the name is blank', () => {
            expect(formatSavedQueriesAsSql([makeQuery({name: ' \n '})], folders)).toContain(
                '-- Name: Untitled\n',
            );
        });

        it('collapses repeated trailing semicolons and whitespace', () => {
            const out = formatSavedQueriesAsSql([makeQuery({sql: 'SELECT 1 ;; \n'})], folders);
            expect(out).toBe('-- Name: Query\nSELECT 1;\n');
        });

        it('puts the terminator on its own line after a trailing line comment', () => {
            const out = formatSavedQueriesAsSql([makeQuery({sql: 'SELECT 1 -- note'})], folders);
            expect(out).toBe('-- Name: Query\nSELECT 1 -- note\n;\n');
        });

        it('puts the terminator on its own line after an unterminated block comment', () => {
            const out = formatSavedQueriesAsSql([makeQuery({sql: 'SELECT 1 /* note'})], folders);
            expect(out).toBe('-- Name: Query\nSELECT 1 /* note\n;\n');
        });
    });
});
