import {describe, it, expect} from 'vitest';
import {
    extractOutline,
    filterOutlineEntries,
    type OutlineEntry,
    getSqlCellExecutionStatus,
    getUnnamedCellsWithContent,
} from '@/utils/notebookOutline';
import type {NotebookCell} from '@/types/notebook';
import type {QueryResult} from '@/types/editor';

function makeQueryResult(overrides: Partial<QueryResult> = {}): QueryResult {
    return {
        columns: [],
        rows: [],
        affected_rows: 0,
        ...overrides,
    };
}

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: 'cell-1',
        type: 'markdown',
        content: '',
        ...overrides,
    };
}

describe('notebookOutline', () => {
    describe('extractOutline', () => {
        it('extracts headings from markdown cells', () => {
            const cells = [
                makeCell({id: 'c1', content: '# Introduction\nSome text\n## Setup'}),
                makeCell({id: 'c2', content: '## Analysis\n### Details'}),
            ];

            const entries = extractOutline(cells);
            expect(entries).toEqual([
                {level: 1, text: 'Introduction', cellId: 'c1', cellIndex: 0, cellType: 'markdown'},
                {level: 2, text: 'Setup', cellId: 'c1', cellIndex: 0, cellType: 'markdown'},
                {level: 2, text: 'Analysis', cellId: 'c2', cellIndex: 1, cellType: 'markdown'},
                {level: 3, text: 'Details', cellId: 'c2', cellIndex: 1, cellType: 'markdown'},
            ]);
        });

        it('includes SQL cells in outline', () => {
            const cells = [
                makeCell({id: 'c1', type: 'sql', content: 'SELECT 1'}),
                makeCell({id: 'c2', type: 'sql', content: 'SELECT 2', name: 'User Query'}),
            ];

            const entries = extractOutline(cells);
            expect(entries).toEqual([
                {
                    level: 1,
                    text: 'SQL #1',
                    cellId: 'c1',
                    cellIndex: 0,
                    cellType: 'sql',
                    status: 'idle',
                },
                {
                    level: 1,
                    text: 'User Query',
                    cellId: 'c2',
                    cellIndex: 1,
                    cellType: 'sql',
                    status: 'idle',
                },
            ]);
        });

        it('uses cell name for markdown cells when set', () => {
            const cells = [makeCell({id: 'c1', content: '# Heading', name: 'My Section'})];

            const entries = extractOutline(cells);
            expect(entries).toEqual([
                {level: 1, text: 'My Section', cellId: 'c1', cellIndex: 0, cellType: 'markdown'},
            ]);
        });

        it('mixes SQL and markdown cells', () => {
            const cells = [
                makeCell({id: 'c1', content: '# Introduction'}),
                makeCell({
                    id: 'c2',
                    type: 'sql',
                    content: 'SELECT * FROM users',
                    name: 'Fetch Users',
                }),
                makeCell({id: 'c3', content: '## Results'}),
            ];

            const entries = extractOutline(cells);
            expect(entries).toHaveLength(3);
            expect(entries[0].text).toBe('Introduction');
            expect(entries[1].text).toBe('Fetch Users');
            expect(entries[1].cellType).toBe('sql');
            expect(entries[2].text).toBe('Results');
        });

        it('returns empty array for empty cells', () => {
            expect(extractOutline([])).toEqual([]);
        });

        it('shows fallback for empty markdown cells without name', () => {
            const cells = [makeCell({id: 'c1', content: ''}), makeCell({id: 'c2', content: '   '})];
            const entries = extractOutline(cells);
            expect(entries).toEqual([
                {level: 1, text: 'MD #1', cellId: 'c1', cellIndex: 0, cellType: 'markdown'},
                {level: 1, text: 'MD #2', cellId: 'c2', cellIndex: 1, cellType: 'markdown'},
            ]);
        });

        it('shows fallback for markdown cells with content but no headings and no name', () => {
            const cells = [makeCell({id: 'c1', content: 'Just plain text without headings'})];
            const entries = extractOutline(cells);
            expect(entries).toEqual([
                {level: 1, text: 'MD #1', cellId: 'c1', cellIndex: 0, cellType: 'markdown'},
            ]);
        });

        it('only extracts h1-h3 headings', () => {
            const cells = [
                makeCell({
                    id: 'c1',
                    content: '# H1\n## H2\n### H3\n#### H4\n##### H5',
                }),
            ];

            const entries = extractOutline(cells);
            expect(entries).toHaveLength(3);
            expect(entries.map((e) => e.level)).toEqual([1, 2, 3]);
        });

        it('trims heading text', () => {
            const cells = [makeCell({id: 'c1', content: '#   Spaced Title   '})];

            const entries = extractOutline(cells);
            expect(entries[0].text).toBe('Spaced Title');
        });
    });

    describe('getUnnamedCellsWithContent', () => {
        it('returns cells without a name that have content', () => {
            const cells = [
                makeCell({id: 'c1', type: 'sql', content: 'SELECT 1'}),
                makeCell({id: 'c2', type: 'sql', content: 'SELECT 2', name: 'Named'}),
                makeCell({id: 'c3', content: '# Hello'}),
            ];

            const result = getUnnamedCellsWithContent(cells);
            expect(result).toHaveLength(2);
            expect(result.map((c) => c.id)).toEqual(['c1', 'c3']);
        });

        it('excludes cells with empty or whitespace-only content', () => {
            const cells = [
                makeCell({id: 'c1', content: ''}),
                makeCell({id: 'c2', content: '   '}),
                makeCell({id: 'c3', content: 'Some content'}),
            ];

            const result = getUnnamedCellsWithContent(cells);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('c3');
        });

        it('returns empty array when all cells are named', () => {
            const cells = [
                makeCell({id: 'c1', content: 'SELECT 1', name: 'Query 1'}),
                makeCell({id: 'c2', content: '# Intro', name: 'Intro Section'}),
            ];

            expect(getUnnamedCellsWithContent(cells)).toEqual([]);
        });

        it('returns empty array for empty cells list', () => {
            expect(getUnnamedCellsWithContent([])).toEqual([]);
        });
    });

    describe('getSqlCellExecutionStatus', () => {
        it('returns idle when SQL cell has no execution fields', () => {
            expect(getSqlCellExecutionStatus({})).toBe('idle');
            expect(getSqlCellExecutionStatus({isLoading: false, result: null})).toBe('idle');
        });

        it('returns running when isLoading is true', () => {
            expect(getSqlCellExecutionStatus({isLoading: true})).toBe('running');
        });

        it('gives precedence to running over existing error or result', () => {
            expect(
                getSqlCellExecutionStatus({
                    isLoading: true,
                    error: 'Syntax error',
                    result: makeQueryResult(),
                }),
            ).toBe('running');
        });

        it('returns failed when error is present and not loading', () => {
            expect(getSqlCellExecutionStatus({error: 'Division by zero', isLoading: false})).toBe(
                'failed',
            );
        });

        it('gives precedence to failed over result when both are present and not loading', () => {
            expect(
                getSqlCellExecutionStatus({
                    error: 'Connection lost',
                    result: makeQueryResult(),
                    isLoading: false,
                }),
            ).toBe('failed');
        });

        it('returns has_output when result is present and no error or loading', () => {
            expect(
                getSqlCellExecutionStatus({
                    result: makeQueryResult({columns: ['id'], rows: [[1]]}),
                    isLoading: false,
                }),
            ).toBe('has_output');
        });

        it('counts empty successful result as has_output', () => {
            expect(
                getSqlCellExecutionStatus({
                    result: makeQueryResult(),
                    isLoading: false,
                }),
            ).toBe('has_output');
        });

        it('immediately reflects cleared outputs as idle', () => {
            const cell = makeCell({
                type: 'sql',
                result: makeQueryResult(),
            });
            expect(getSqlCellExecutionStatus(cell)).toBe('has_output');

            // Simulate clearing outputs
            cell.result = null;
            cell.error = undefined;
            cell.isLoading = false;
            expect(getSqlCellExecutionStatus(cell)).toBe('idle');
        });
    });

    describe('extractOutline execution status integration', () => {
        it('derives execution status for SQL cells while leaving markdown cells unchanged', () => {
            const cells = [
                makeCell({id: 'c1', content: '# Section 1'}),
                makeCell({id: 'c2', type: 'sql', content: 'SELECT 1', isLoading: true}),
                makeCell({id: 'c3', type: 'sql', content: 'SELECT 2', error: 'Fail'}),
                makeCell({
                    id: 'c4',
                    type: 'sql',
                    content: 'SELECT 3',
                    result: makeQueryResult(),
                }),
                makeCell({id: 'c5', type: 'sql', content: 'SELECT 4'}),
                makeCell({id: 'c6', content: '## Section 2'}),
            ];

            const entries = extractOutline(cells);
            expect(entries).toHaveLength(6);

            // Markdown entries have no status
            expect(entries[0].status).toBeUndefined();
            expect(entries[0].cellType).toBe('markdown');
            expect(entries[5].status).toBeUndefined();
            expect(entries[5].cellType).toBe('markdown');

            // SQL entries have their derived status
            expect(entries[1]).toMatchObject({cellId: 'c2', cellType: 'sql', status: 'running'});
            expect(entries[2]).toMatchObject({cellId: 'c3', cellType: 'sql', status: 'failed'});
            expect(entries[3]).toMatchObject({cellId: 'c4', cellType: 'sql', status: 'has_output'});
            expect(entries[4]).toMatchObject({cellId: 'c5', cellType: 'sql', status: 'idle'});
        });
    });

    describe('filterOutlineEntries', () => {
        const sampleEntries: OutlineEntry[] = [
            {
                level: 1,
                text: 'Introduction',
                cellId: 'cell-md-1',
                cellIndex: 0,
                cellType: 'markdown',
            },
            {
                level: 2,
                text: 'Monthly Revenue',
                cellId: 'cell-md-1',
                cellIndex: 0,
                cellType: 'markdown',
            },
            {level: 1, text: 'SQL #2', cellId: 'cell-sql-2', cellIndex: 1, cellType: 'sql'},
            {
                level: 1,
                text: 'Active Users Query',
                cellId: 'cell-sql-3',
                cellIndex: 2,
                cellType: 'sql',
            },
            {level: 1, text: 'MD #4', cellId: 'cell-md-4', cellIndex: 3, cellType: 'markdown'},
        ];

        it('returns all entries unchanged when query is empty or whitespace only', () => {
            expect(filterOutlineEntries(sampleEntries, '')).toEqual(sampleEntries);
            expect(filterOutlineEntries(sampleEntries, '   ')).toEqual(sampleEntries);
        });

        it('filters by SQL cell names case-insensitively', () => {
            const result = filterOutlineEntries(sampleEntries, 'active');
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                level: 1,
                text: 'Active Users Query',
                cellId: 'cell-sql-3',
                cellIndex: 2,
                cellType: 'sql',
            });
        });

        it('filters by Markdown headings case-insensitively', () => {
            const result = filterOutlineEntries(sampleEntries, 'REVENUE');
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                level: 2,
                text: 'Monthly Revenue',
                cellId: 'cell-md-1',
                cellIndex: 0,
                cellType: 'markdown',
            });
        });

        it('filters by fallback labels for SQL and Markdown cells', () => {
            const sqlFallback = filterOutlineEntries(sampleEntries, 'SQL #2');
            expect(sqlFallback).toHaveLength(1);
            expect(sqlFallback[0].cellId).toBe('cell-sql-2');

            const mdFallback = filterOutlineEntries(sampleEntries, 'md #4');
            expect(mdFallback).toHaveLength(1);
            expect(mdFallback[0].cellId).toBe('cell-md-4');
        });

        it('trims leading and trailing whitespace from the search query', () => {
            const result = filterOutlineEntries(sampleEntries, '   monthly   ');
            expect(result).toHaveLength(1);
            expect(result[0].text).toBe('Monthly Revenue');
        });

        it('returns an empty array when no entries match', () => {
            expect(filterOutlineEntries(sampleEntries, 'nonexistent')).toEqual([]);
        });

        it('preserves original order, indentation level, and navigation target cell IDs', () => {
            const multipleMatches: OutlineEntry[] = [
                {level: 1, text: 'User Overview', cellId: 'c1', cellIndex: 0, cellType: 'markdown'},
                {
                    level: 3,
                    text: 'Sub-section Users',
                    cellId: 'c1',
                    cellIndex: 0,
                    cellType: 'markdown',
                },
                {level: 1, text: 'Fetch Users SQL', cellId: 'c2', cellIndex: 1, cellType: 'sql'},
            ];
            const result = filterOutlineEntries(multipleMatches, 'user');
            expect(result).toHaveLength(3);
            expect(result.map((e) => e.cellId)).toEqual(['c1', 'c1', 'c2']);
            expect(result.map((e) => e.level)).toEqual([1, 3, 1]);
            expect(result[0].cellIndex).toBe(0);
            expect(result[1].cellIndex).toBe(0);
            expect(result[2].cellIndex).toBe(1);
        });
    });
});
