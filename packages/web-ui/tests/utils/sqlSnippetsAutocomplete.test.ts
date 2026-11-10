import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
    registerSqlAutocomplete as registerSqlAutocompleteImpl,
    type AutocompleteKeywordCase,
} from '@/utils/autocomplete';
import {saveSqlSnippets, type SqlSnippet} from '@/utils/sqlSnippets';
import type {TypedCommandCaller} from '@/api/contract';

const createMockMonaco = () => ({
    languages: {
        CompletionItemKind: {
            Field: 1,
            Keyword: 2,
            Class: 3,
            Snippet: 28,
        },
        CompletionItemInsertTextRule: {
            None: 0,
            InsertAsSnippet: 4,
        },
        registerCompletionItemProvider: vi.fn((_language, provider) => ({
            dispose: vi.fn(),
            provider,
        })),
    },
});

const createMockModel = (value: string, wordAtPosition: string = '') => ({
    getValue: () => value,
    getOffsetAt: vi.fn((pos) => pos.lineNumber * 100 + pos.column),
    getWordUntilPosition: vi.fn(() => ({
        word: wordAtPosition,
        startColumn: value.length - wordAtPosition.length + 1,
        endColumn: value.length + 1,
    })),
    getValueInRange: vi.fn((range) => {
        const lines = value.split('\n');
        if (range.startLineNumber === range.endLineNumber) {
            return (
                lines[range.startLineNumber - 1]?.substring(
                    range.startColumn - 1,
                    range.endColumn - 1,
                ) || ''
            );
        }
        return value;
    }),
});

const dummyClient = {
    call: vi.fn().mockResolvedValue([]),
} as unknown as TypedCommandCaller;

describe('SQL Snippets autocomplete integration', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('suggests snippets matching typed prefix and marks them as InsertAsSnippet', async () => {
        const testSnippets: SqlSnippet[] = [
            {
                id: 's-1',
                name: 'Select All',
                prefix: 'selall',
                body: 'SELECT ${1:*} FROM ${2:table};',
                description: 'Select all columns',
                dialect: 'all',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
            {
                id: 's-2',
                name: 'Postgres Only',
                prefix: 'selpg',
                body: 'SELECT ${1:*} FROM ${2:table} RETURNING *;',
                dialect: 'postgres',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
        ];
        saveSqlSnippets(testSnippets);

        const monaco = createMockMonaco();
        const registration = registerSqlAutocompleteImpl(
            monaco as any,
            'conn1',
            [],
            null,
            'postgres',
            dummyClient,
        );

        const provider = (registration as any).provider;
        const model = createMockModel('sel', 'sel');
        const result = await provider.provideCompletionItems(model, {lineNumber: 1, column: 4});

        const snippetItems = result.suggestions.filter((s: any) => s.kind === 28);
        expect(snippetItems.length).toBe(2);
        expect(snippetItems[0].label).toBe('selall');
        expect(snippetItems[0].insertText).toBe('SELECT ${1:*} FROM ${2:table};');
        expect(snippetItems[0].insertTextRules).toBe(4); // InsertAsSnippet

        expect(snippetItems[1].label).toBe('selpg');
    });

    it('filters out snippets from incompatible dialects', async () => {
        const testSnippets: SqlSnippet[] = [
            {
                id: 's-1',
                name: 'Postgres Only',
                prefix: 'pgonly',
                body: 'SELECT 1;',
                dialect: 'postgres',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
            {
                id: 's-2',
                name: 'MySQL Only',
                prefix: 'myonly',
                body: 'SELECT 2;',
                dialect: 'mysql',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
        ];
        saveSqlSnippets(testSnippets);

        const monaco = createMockMonaco();
        const registration = registerSqlAutocompleteImpl(
            monaco as any,
            'conn1',
            [],
            null,
            'mysql',
            dummyClient,
        );

        const provider = (registration as any).provider;
        const model = createMockModel('my', 'my');
        const result = await provider.provideCompletionItems(model, {lineNumber: 1, column: 3});

        const snippetItems = result.suggestions.filter((s: any) => s.kind === 28);
        expect(snippetItems.length).toBe(1);
        expect(snippetItems[0].label).toBe('myonly');
    });

    it('does not offer snippets inside comments or string literals', async () => {
        saveSqlSnippets([
            {
                id: 's-1',
                name: 'Select All',
                prefix: 'sel',
                body: 'SELECT * FROM tbl;',
                dialect: 'all',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
        ]);

        const monaco = createMockMonaco();
        const registration = registerSqlAutocompleteImpl(
            monaco as any,
            'conn1',
            [],
            null,
            'postgres',
            dummyClient,
        );
        const provider = (registration as any).provider;

        // Inside comment
        const commentModel = createMockModel('-- comment sel', 'sel');
        const commentResult = await provider.provideCompletionItems(commentModel, {
            lineNumber: 1,
            column: 15,
        });
        expect(commentResult.suggestions.filter((s: any) => s.kind === 28)).toHaveLength(0);

        // Inside string literal
        const stringModel = createMockModel("'text sel", 'sel');
        const stringResult = await provider.provideCompletionItems(stringModel, {
            lineNumber: 1,
            column: 10,
        });
        expect(stringResult.suggestions.filter((s: any) => s.kind === 28)).toHaveLength(0);
    });

    it('resolves active dialect from custom plugin capabilities and excludes mismatched dialect snippets', async () => {
        const testSnippets: SqlSnippet[] = [
            {
                id: 's-1',
                name: 'Postgres Only',
                prefix: 'spec_pg',
                body: 'SELECT 1 RETURNING *;',
                dialect: 'postgres',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
            {
                id: 's-2',
                name: 'MySQL Only',
                prefix: 'spec_my',
                body: 'SELECT 1 LIMIT 1;',
                dialect: 'mysql',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
            {
                id: 's-3',
                name: 'Universal Snippet',
                prefix: 'spec_uni',
                body: 'SELECT *;',
                dialect: 'all',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
        ];
        saveSqlSnippets(testSnippets);

        // Custom plugin driver with { capabilities: { sql_dialect: 'mysql' } }
        const customPluginDriver = {
            id: 'custom-mysql-plugin',
            capabilities: {
                sql_dialect: 'mysql',
            },
        };

        const monaco = createMockMonaco();
        const registration = registerSqlAutocompleteImpl(
            monaco as any,
            'conn1',
            [],
            null,
            customPluginDriver as any,
            dummyClient,
        );

        const provider = (registration as any).provider;
        const model = createMockModel('spec', 'spec');
        const result = await provider.provideCompletionItems(model, {lineNumber: 1, column: 5});

        const snippetLabels = result.suggestions
            .filter((s: any) => s.kind === 28)
            .map((s: any) => s.label);

        // Must offer 'spec_my' and 'spec_uni', but NOT 'spec_pg'
        expect(snippetLabels).toContain('spec_my');
        expect(snippetLabels).toContain('spec_uni');
        expect(snippetLabels).not.toContain('spec_pg');
    });

    it('offers a plugin-scoped snippet only to its own active driver', async () => {
        saveSqlSnippets([
            {
                id: 'ora',
                name: 'Oracle',
                prefix: 'ora',
                body: 'SELECT * FROM dual;',
                dialect: 'driver:oracle',
                createdAt: '',
                updatedAt: '',
            },
        ]);
        const monaco = createMockMonaco();
        const caps = {sql_dialect: 'oracle'};
        const model = createMockModel('ora', 'ora');
        const provider = (
            registerSqlAutocompleteImpl(
                monaco as any,
                'conn1',
                [],
                null,
                caps as any,
                dummyClient,
                'match',
                'oracle',
            ) as any
        ).provider;
        const result = await provider.provideCompletionItems(model, {lineNumber: 1, column: 4});
        expect(
            result.suggestions.some((item: any) => item.label === 'ora' && item.kind === 28),
        ).toBe(true);
        const other = (
            registerSqlAutocompleteImpl(
                monaco as any,
                'conn1',
                [],
                null,
                caps as any,
                dummyClient,
                'match',
                'another',
            ) as any
        ).provider;
        const otherResult = await other.provideCompletionItems(model, {lineNumber: 1, column: 4});
        expect(
            otherResult.suggestions.some((item: any) => item.label === 'ora' && item.kind === 28),
        ).toBe(false);
    });

    it('does not offer database-specific snippets for an unknown or generic plugin dialect', async () => {
        const testSnippets: SqlSnippet[] = [
            {
                id: 's-1',
                name: 'Postgres Only',
                prefix: 'spec_pg',
                body: 'SELECT 1 RETURNING *;',
                dialect: 'postgres',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
            {
                id: 's-2',
                name: 'Universal Snippet',
                prefix: 'spec_uni',
                body: 'SELECT *;',
                dialect: 'all',
                createdAt: '2026-11-07T00:00:00.000Z',
                updatedAt: '2026-11-07T00:00:00.000Z',
            },
        ];
        saveSqlSnippets(testSnippets);

        // Custom plugin driver with unknown/generic dialect
        const unknownDriver = {
            id: 'custom-generic-plugin',
            capabilities: {
                sql_dialect: 'generic',
            },
        };

        const monaco = createMockMonaco();
        const registration = registerSqlAutocompleteImpl(
            monaco as any,
            'conn1',
            [],
            null,
            unknownDriver as any,
            dummyClient,
        );

        const provider = (registration as any).provider;
        const model = createMockModel('spec', 'spec');
        const result = await provider.provideCompletionItems(model, {lineNumber: 1, column: 5});

        const snippetLabels = result.suggestions
            .filter((s: any) => s.kind === 28)
            .map((s: any) => s.label);

        expect(snippetLabels).toContain('spec_uni');
        expect(snippetLabels).not.toContain('spec_pg');
    });
});
