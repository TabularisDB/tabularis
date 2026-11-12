import {describe, it, expect, beforeEach} from 'vitest';
import {
    validateSnippetPrefix,
    filterSqlSnippets,
    validateSnippetBody,
    snippetPrefixConflicts,
    getSnippetCopyName,
    getSnippetCopyPrefix,
    normalizeDriverToDialect,
    isSnippetDialectCompatible,
    isOffsetInCommentOrString,
    loadSqlSnippets,
    saveSqlSnippets,
    upsertSqlSnippet,
    deleteSqlSnippet,
    resetSqlSnippetsCache,
    DEFAULT_SQL_SNIPPETS,
    SQL_SNIPPETS_STORAGE_KEY,
    type SqlSnippet,
} from '@/utils/sqlSnippets';

function snippet(partial: Partial<SqlSnippet> & Pick<SqlSnippet, 'id' | 'prefix'>): SqlSnippet {
    return {
        name: partial.name ?? partial.prefix,
        body: 'SELECT 1;',
        createdAt: '',
        updatedAt: '',
        ...partial,
    };
}

describe('sqlSnippets utils', () => {
    describe('filterSqlSnippets', () => {
        const snippets = [
            {
                id: 'generic',
                name: 'Orders',
                prefix: 'ord',
                body: 'secret body',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'pg',
                name: 'Postgres',
                prefix: 'pg_orders',
                description: 'Sales report',
                dialect: 'postgres' as const,
                body: 'SELECT 1',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'plugin',
                name: 'Plugin',
                prefix: 'plugin',
                description: 'ORDERS',
                dialect: 'driver:offline' as const,
                body: 'SELECT 2',
                createdAt: '',
                updatedAt: '',
            },
            {
                id: 'explicit-generic',
                name: 'Other',
                prefix: 'other',
                dialect: 'all' as const,
                body: 'SELECT 3',
                createdAt: '',
                updatedAt: '',
            },
        ];

        it('matches name, prefix and optional description without changing order or records', () => {
            expect(filterSqlSnippets(snippets, '  ORDERS  ', '')).toEqual(snippets.slice(0, 3));
            expect(filterSqlSnippets(snippets, 'sales', '')).toEqual([snippets[1]]);
            expect(filterSqlSnippets(snippets, 'secret body', '')).toEqual([]);
            expect(filterSqlSnippets(snippets, '  ', '')).toEqual(snippets);
            expect(filterSqlSnippets(snippets, '', '')[0]).toBe(snippets[0]);
        });

        it('combines exact scope and text filters, including legacy generic and offline plugins', () => {
            expect(filterSqlSnippets(snippets, 'orders', 'postgres')).toEqual([snippets[1]]);
            expect(filterSqlSnippets(snippets, 'orders', 'driver:offline')).toEqual([snippets[2]]);
            expect(filterSqlSnippets(snippets, '', 'all')).toEqual([snippets[0], snippets[3]]);
            expect(filterSqlSnippets(snippets, 'sales', 'all')).toEqual([]);
            expect(filterSqlSnippets(snippets, '', 'driver:off')).toEqual([]);
            expect(filterSqlSnippets([], '', '')).toEqual([]);
        });
    });

    beforeEach(() => {
        localStorage.clear();
    });

    describe('validation', () => {
        it('validates snippet prefixes', () => {
            expect(validateSnippetPrefix('sel').valid).toBe(true);
            expect(validateSnippetPrefix('my_prefix_123').valid).toBe(true);
            expect(validateSnippetPrefix('kebab-case').valid).toBe(true);
            expect(validateSnippetPrefix('').valid).toBe(false);
            expect(validateSnippetPrefix('   ').valid).toBe(false);
            expect(validateSnippetPrefix('prefix with spaces').valid).toBe(false);
            expect(validateSnippetPrefix('prefix!@#').valid).toBe(false);
        });

        it('detects prefix collisions across overlapping dialect scopes', () => {
            const snippets = [
                snippet({id: 'all', prefix: 'orders', dialect: 'all'}),
                snippet({id: 'pg', prefix: 'pgonly', dialect: 'postgres'}),
            ];
            expect(snippetPrefixConflicts(snippets, 'orders', 'mysql')).toBe(true);
            expect(snippetPrefixConflicts(snippets, 'Orders', 'postgres')).toBe(true);
            expect(snippetPrefixConflicts(snippets, 'pgonly', 'postgres')).toBe(true);
            expect(snippetPrefixConflicts(snippets, 'pgonly', 'mysql')).toBe(false);
            expect(snippetPrefixConflicts(snippets, 'pgonly', 'all')).toBe(true);
            expect(snippetPrefixConflicts(snippets, 'orders', 'all', 'all')).toBe(false);
        });

        it('allocates unique copy names and prefixes', () => {
            expect(getSnippetCopyName('Active orders', [])).toBe('Active orders (copy)');
            expect(
                getSnippetCopyName('Active orders', [
                    snippet({id: 'c', name: 'Active orders (copy)', prefix: 'x'}),
                ]),
            ).toBe('Active orders (copy 2)');
            expect(getSnippetCopyPrefix('orders', 'all', [])).toBe('orders_copy');
            expect(
                getSnippetCopyPrefix('orders', 'postgres', [
                    snippet({id: 'c', prefix: 'orders_copy', dialect: 'postgres'}),
                ]),
            ).toBe('orders_copy_2');
            expect(
                getSnippetCopyPrefix('orders', 'mysql', [
                    snippet({id: 'c', prefix: 'orders_copy', dialect: 'postgres'}),
                ]),
            ).toBe('orders_copy');
        });

        it('validates snippet bodies', () => {
            expect(validateSnippetBody('SELECT * FROM tbl;').valid).toBe(true);
            expect(validateSnippetBody('').valid).toBe(false);
            expect(validateSnippetBody('   ').valid).toBe(false);
        });
    });

    describe('dialect compatibility', () => {
        it('normalizes driver strings', () => {
            expect(normalizeDriverToDialect('postgres')).toBe('postgres');
            expect(normalizeDriverToDialect('postgresql')).toBe('postgres');
            expect(normalizeDriverToDialect('pg')).toBe('postgres');
            expect(normalizeDriverToDialect('pg_pool')).toBe('postgres');
            expect(normalizeDriverToDialect('rpg-plugin')).toBe('all');
            expect(normalizeDriverToDialect('mysql')).toBe('mysql');
            expect(normalizeDriverToDialect('mariadb')).toBe('mysql');
            expect(normalizeDriverToDialect('sqlite')).toBe('sqlite');
            expect(normalizeDriverToDialect('unknown')).toBe('all');
            expect(normalizeDriverToDialect(null)).toBe('all');
        });

        it('checks dialect compatibility correctly', () => {
            expect(isSnippetDialectCompatible('all', 'postgres')).toBe(true);
            expect(isSnippetDialectCompatible(undefined, 'postgres')).toBe(true);
            expect(isSnippetDialectCompatible('postgres', 'postgres')).toBe(true);
            expect(isSnippetDialectCompatible('postgres', 'mysql')).toBe(false);
            expect(isSnippetDialectCompatible('mysql', 'mysql')).toBe(true);
            expect(isSnippetDialectCompatible('postgres', 'all')).toBe(false);
        });

        it('resolves dialect from capabilities and descriptors', () => {
            expect(normalizeDriverToDialect({sql_dialect: 'mysql'})).toBe('mysql');
            expect(normalizeDriverToDialect({capabilities: {sql_dialect: 'postgres'}})).toBe(
                'postgres',
            );
            expect(
                normalizeDriverToDialect({capabilities: {sql_syntax: {extends: 'sqlite'}}}),
            ).toBe('sqlite');
            expect(normalizeDriverToDialect({capabilities: {sql_dialect: 'oracle'}})).toBe(
                'oracle',
            );
        });
    });

    describe('comment and string boundary detection', () => {
        it('identifies offsets inside strings and comments', () => {
            const sql =
                "SELECT * FROM users WHERE name = 'John' -- this is a comment\nAND age > 20;";
            // 'John' starts at index 33 and ends at 39
            const quoteOffset = sql.indexOf("'John'") + 2;
            expect(isOffsetInCommentOrString(sql, quoteOffset)).toBe(true);

            // Inside comment
            const commentOffset = sql.indexOf('-- this is') + 4;
            expect(isOffsetInCommentOrString(sql, commentOffset)).toBe(true);

            // Outside strings/comments (e.g. at SELECT)
            expect(isOffsetInCommentOrString(sql, 2)).toBe(false);
            // At WHERE
            expect(isOffsetInCommentOrString(sql, sql.indexOf('WHERE'))).toBe(false);
        });
    });

    describe('storage and CRUD', () => {
        it('initializes with default snippets when storage is empty', () => {
            const snippets = loadSqlSnippets();
            expect(snippets.length).toBe(DEFAULT_SQL_SNIPPETS.length);
            expect(snippets[0].prefix).toBe('sel');
        });

        it('saves and loads customized snippets', () => {
            const custom = [
                {
                    id: 'custom-1',
                    name: 'Count rows',
                    prefix: 'cnt',
                    body: 'SELECT COUNT(*) FROM ${1:tbl};',
                    createdAt: '2026-11-07T00:00:00.000Z',
                    updatedAt: '2026-11-07T00:00:00.000Z',
                },
            ];
            saveSqlSnippets(custom);

            const loaded = loadSqlSnippets();
            expect(loaded.length).toBe(1);
            expect(loaded[0].prefix).toBe('cnt');
        });

        it('upserts and deletes snippets', () => {
            const created = upsertSqlSnippet({
                name: 'Test Snippet',
                prefix: 'test',
                body: 'SELECT ${1:1};',
            });

            expect(created.id).toBeDefined();
            let all = loadSqlSnippets();
            expect(all.some((s) => s.id === created.id)).toBe(true);

            // Update
            const updated = upsertSqlSnippet({
                id: created.id,
                name: 'Renamed Snippet',
                prefix: 'test2',
                body: 'SELECT ${1:2};',
            });
            expect(updated.name).toBe('Renamed Snippet');
            expect(updated.prefix).toBe('test2');

            // Delete
            deleteSqlSnippet(created.id);
            all = loadSqlSnippets();
            expect(all.some((s) => s.id === created.id)).toBe(false);
        });

        it('persists deletion of all snippets across reload', () => {
            // Initially loads defaults
            const defaults = loadSqlSnippets();
            expect(defaults.length).toBeGreaterThan(0);

            // Delete every snippet
            for (const s of defaults) {
                deleteSqlSnippet(s.id);
            }

            // Immediately after deletion: empty list
            expect(loadSqlSnippets().length).toBe(0);

            // Simulate reload by clearing in-memory cache and re-reading localStorage
            resetSqlSnippetsCache();
            const reloaded = loadSqlSnippets();
            expect(reloaded.length).toBe(0);
        });
    });
});
