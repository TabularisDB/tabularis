import {describe, expect, it} from 'vitest';
import {
    buildUsageSnippet,
    findColumnReferences,
    redactSqlLiterals,
    strongestMatch,
    type ColumnUsageTarget,
    type RelationRef,
} from '@/utils/columnUsage';
import type {DriverCapabilities} from '@/types/plugins';
import {resolveSqlSyntax} from '@/utils/sqlSyntax';

const ordersPublic: ColumnUsageTarget = {schema: 'public', table: 'orders', column: 'customer_id'};
const ordersNoSchema: ColumnUsageTarget = {
    database: 'shop',
    table: 'orders',
    column: 'customer_id',
};

const summary = (sql: string, target: ColumnUsageTarget, options = {}) =>
    findColumnReferences(sql, target, {dialect: 'postgres', ...options}).map((m) =>
        m.reason ? `${m.confidence}:${m.reason}` : m.confidence,
    );

describe('columnUsage', () => {
    describe('findColumnReferences', () => {
        it('resolves a schema-qualified table through its alias', () => {
            const sql = 'SELECT o.customer_id FROM public.orders o WHERE o.id = 1';
            expect(summary(sql, ordersPublic)).toEqual(['parsed']);
        });

        it('resolves AS aliases and the table name used as a qualifier', () => {
            expect(summary('SELECT x.customer_id FROM public.orders AS x', ordersPublic)).toEqual([
                'parsed',
            ]);
            expect(summary('SELECT orders.customer_id FROM public.orders', ordersPublic)).toEqual([
                'parsed',
            ]);
        });

        it('ignores the same table and column names in another schema', () => {
            const sql = 'SELECT o.customer_id FROM sales.orders o';
            expect(summary(sql, ordersPublic)).toEqual([]);
            expect(
                summary('SELECT sales.orders.customer_id FROM sales.orders', ordersPublic),
            ).toEqual([]);
        });

        it('ignores a same-name column of another table', () => {
            const sql = 'SELECT c.customer_id FROM public.customers c';
            expect(summary(sql, ordersPublic)).toEqual([]);
            expect(summary('SELECT customer_id FROM public.invoices', ordersPublic)).toEqual([]);
        });

        it('tells two tables with the same name in different schemas apart in one query', () => {
            const sql =
                'SELECT a.customer_id, b.customer_id FROM public.orders a JOIN archive.orders b ON a.id = b.id';
            const matches = findColumnReferences(sql, ordersPublic, {dialect: 'postgres'});
            expect(matches).toHaveLength(1);
            expect(sql.slice(matches[0].start - 2, matches[0].end)).toBe('a.customer_id');
        });

        it('marks an unqualified table as uncertain when the schema it resolves to is unknown', () => {
            expect(summary('SELECT o.customer_id FROM orders o', ordersPublic)).toEqual([
                'uncertain:unqualified-schema',
            ]);
        });

        it('accepts an unqualified table when the default schema is the target schema', () => {
            expect(
                summary('SELECT o.customer_id FROM orders o', ordersPublic, {
                    defaultSchema: 'public',
                }),
            ).toEqual(['parsed']);
            expect(
                summary('SELECT o.customer_id FROM orders o', ordersPublic, {
                    defaultSchema: 'sales',
                }),
            ).toEqual(['uncertain:unqualified-schema']);
        });

        it('matches unqualified tables on drivers without schemas', () => {
            expect(summary('SELECT customer_id FROM orders', ordersNoSchema)).toEqual(['parsed']);
            expect(summary('SELECT o.customer_id FROM shop.orders o', ordersNoSchema)).toEqual([
                'parsed',
            ]);
            expect(summary('SELECT o.customer_id FROM other.orders o', ordersNoSchema)).toEqual([
                'uncertain:unresolved-qualifier',
            ]);
        });

        it('marks an unqualified column as uncertain when another table may have it', () => {
            const sql = 'SELECT customer_id FROM orders o JOIN customers c ON c.id = o.customer_id';
            expect(summary(sql, ordersNoSchema)).toEqual(['uncertain:several-tables', 'parsed']);
        });

        it('uses known columns to clear an unqualified column across several tables', () => {
            const sql = 'SELECT customer_id FROM orders o JOIN customers c ON c.id = o.customer_id';
            const columnsOf = (ref: RelationRef) =>
                ref.name === 'customers' ? ['id', 'name'] : undefined;
            expect(summary(sql, ordersNoSchema, {columnsOf})).toEqual(['parsed', 'parsed']);
            const sharing = (ref: RelationRef) =>
                ref.name === 'customers' ? ['id', 'customer_id'] : undefined;
            expect(summary(sql, ordersNoSchema, {columnsOf: sharing})).toEqual([
                'uncertain:several-tables',
                'parsed',
            ]);
        });

        it('marks a qualifier that is not a known alias as unresolved', () => {
            const sql = 'SELECT z.customer_id FROM orders o';
            expect(summary(sql, ordersNoSchema)).toEqual(['uncertain:unresolved-qualifier']);
        });

        it('marks an alias bound to different tables as a conflict', () => {
            const sql =
                'SELECT t.customer_id FROM orders t WHERE EXISTS (SELECT 1 FROM invoices t WHERE t.customer_id = 1)';
            expect(summary(sql, ordersNoSchema)).toEqual([
                'uncertain:alias-conflict',
                'uncertain:alias-conflict',
            ]);
        });

        it('follows columns read through a derived table', () => {
            const sql = 'SELECT d.customer_id FROM (SELECT customer_id FROM orders) d';
            expect(summary(sql, ordersNoSchema)).toEqual(['uncertain:derived-table', 'parsed']);
            const cte =
                'WITH recent AS (SELECT customer_id FROM orders) SELECT r.customer_id FROM recent r';
            expect(summary(cte, ordersNoSchema)).toEqual(['parsed', 'uncertain:derived-table']);
        });

        it('reads INSERT column lists, UPDATE targets and DELETE filters', () => {
            expect(
                summary('INSERT INTO orders (id, customer_id) VALUES (1, 2)', ordersNoSchema),
            ).toEqual(['parsed']);
            expect(
                summary('UPDATE orders o SET customer_id = 3 WHERE o.id = 1', ordersNoSchema),
            ).toEqual(['parsed']);
            expect(summary('DELETE FROM orders WHERE customer_id = 3', ordersNoSchema)).toEqual([
                'parsed',
            ]);
        });

        it('never counts strings, comments, output aliases or function names', () => {
            const sql = `SELECT 'customer_id' AS label, id AS customer_id, customer_id() -- customer_id
                FROM orders /* customer_id */`;
            expect(summary(sql, ordersNoSchema)).toEqual([]);
        });

        it('flags SELECT * and alias.* on the target table as a wildcard once per statement', () => {
            expect(summary('SELECT * FROM orders', ordersNoSchema)).toEqual(['uncertain:wildcard']);
            expect(summary('SELECT o.* , o.* FROM orders o', ordersNoSchema)).toEqual([
                'uncertain:wildcard',
            ]);
            expect(summary('SELECT count(*) FROM orders', ordersNoSchema)).toEqual([]);
            expect(summary('SELECT * FROM customers', ordersNoSchema)).toEqual([]);
        });

        it('marks dynamic SQL that mentions the column as uncertain', () => {
            const plpgsql = "EXECUTE 'UPDATE orders SET customer_id = $1' USING 4";
            expect(summary(plpgsql, ordersNoSchema)).toEqual(['uncertain:dynamic-sql']);
            const mssql = "EXEC sp_executesql N'SELECT customer_id FROM orders'";
            expect(
                findColumnReferences(mssql, ordersNoSchema, {dialect: 'mssql'}).map(
                    (m) => m.reason,
                ),
            ).toEqual(['dynamic-sql']);
            expect(summary("SELECT 'UPDATE orders SET customer_id = 1'", ordersNoSchema)).toEqual(
                [],
            );
        });

        it('marks a mention without any parsed table as textual', () => {
            expect(summary('customer_id = 5 AND orders', ordersNoSchema)).toEqual([
                'uncertain:textual',
            ]);
            expect(summary('customer_id = 5', ordersNoSchema)).toEqual([]);
        });

        it('checks an unqualified column against the tables of its own subquery', () => {
            const sql =
                'SELECT name FROM customers c WHERE c.id IN (SELECT customer_id FROM orders)';
            expect(summary(sql, ordersNoSchema)).toEqual(['parsed']);
            const outer = 'SELECT customer_id FROM customers WHERE id IN (SELECT id FROM orders)';
            expect(summary(outer, ordersNoSchema)).toEqual([]);
            const correlated =
                'SELECT id FROM orders WHERE EXISTS (SELECT 1 FROM refunds r WHERE r.cid = customer_id)';
            expect(summary(correlated, ordersNoSchema)).toEqual(['uncertain:several-tables']);
            const refunds = (ref: RelationRef) =>
                ref.name === 'refunds' ? ['id', 'cid'] : undefined;
            expect(summary(correlated, ordersNoSchema, {columnsOf: refunds})).toEqual(['parsed']);
            const owned = (ref: RelationRef) =>
                ref.name === 'refunds' ? ['id', 'customer_id'] : undefined;
            expect(summary(correlated, ordersNoSchema, {columnsOf: owned})).toEqual([]);
        });

        it('analyses every statement of a script on its own', () => {
            const sql = 'SELECT customer_id FROM orders; SELECT customer_id FROM customers;';
            expect(summary(sql, ordersNoSchema)).toEqual(['parsed']);
        });

        it('follows the dialect quoting rules', () => {
            expect(
                findColumnReferences('SELECT `o`.`Customer_Id` FROM `orders` `o`', ordersNoSchema, {
                    dialect: 'mysql',
                }).map((m) => m.confidence),
            ).toEqual(['parsed']);
            expect(
                findColumnReferences(
                    'SELECT [o].[customer_id] FROM [dbo].[orders] [o]',
                    {
                        schema: 'dbo',
                        table: 'orders',
                        column: 'customer_id',
                    },
                    {dialect: 'mssql'},
                ).map((m) => m.confidence),
            ).toEqual(['parsed']);
            // Quoted PostgreSQL identifiers keep their case.
            expect(summary('SELECT "Customer_Id" FROM orders', ordersNoSchema)).toEqual([]);
            expect(summary('SELECT "customer_id" FROM "orders"', ordersNoSchema)).toEqual([
                'parsed',
            ]);
            // A MySQL `#` comment is a comment, a PostgreSQL dollar body is a string.
            expect(
                findColumnReferences('SELECT 1 FROM orders # customer_id', ordersNoSchema, {
                    dialect: 'mysql',
                }),
            ).toEqual([]);
            expect(summary('SELECT $$customer_id$$ FROM orders', ordersNoSchema)).toEqual([]);
        });

        it('honours a plugin capabilities syntax', () => {
            const caps = {sql_dialect: 'mysql', identifier_quote: '`'} as DriverCapabilities;
            const syntax = resolveSqlSyntax(caps);
            expect(
                findColumnReferences('SELECT `customer_id` FROM `orders`', ordersNoSchema, {
                    dialect: syntax,
                }).map((m) => m.confidence),
            ).toEqual(['parsed']);
        });

        it('reads the payload of MySQL executable comments', () => {
            const sql = '/*!50001 SELECT o.customer_id FROM orders o */';
            expect(
                findColumnReferences(sql, ordersNoSchema, {dialect: 'mysql'}).map(
                    (m) => m.confidence,
                ),
            ).toEqual(['parsed']);
        });

        it('handles empty and non-ASCII input', () => {
            expect(findColumnReferences('', ordersNoSchema)).toEqual([]);
            const target = {table: 'commandes', column: 'clé_client'};
            expect(summary('SELECT c.clé_client FROM commandes c', target)).toEqual(['parsed']);
            expect(summary('SELECT c.clé_client2 FROM commandes c', target)).toEqual([]);
        });
    });

    describe('strongestMatch', () => {
        it('prefers parsed matches, then the earliest one', () => {
            expect(
                strongestMatch([
                    {confidence: 'uncertain', reason: 'wildcard', start: 0, end: 1},
                    {confidence: 'parsed', start: 9, end: 12},
                    {confidence: 'parsed', start: 4, end: 6},
                ])?.start,
            ).toBe(4);
            expect(strongestMatch([])).toBeUndefined();
        });
    });

    describe('redactSqlLiterals', () => {
        it('replaces strings and numbers and drops comments', () => {
            expect(
                redactSqlLiterals(
                    "SELECT * FROM orders WHERE email = 'a@b.c' AND total > 10.5 -- secret",
                    'postgres',
                ),
            ).toBe("SELECT * FROM orders WHERE email = '?' AND total > ?");
            expect(redactSqlLiterals("SELECT $tag$x$tag$, E'it\\'s'", 'postgres')).toBe(
                "SELECT '?', '?'",
            );
            expect(redactSqlLiterals("SELECT t1.c2 FROM t1 WHERE n = N'é'", 'mssql')).toBe(
                "SELECT t1.c2 FROM t1 WHERE n = '?'",
            );
        });
    });

    describe('buildUsageSnippet', () => {
        it('cuts a window around the match, redacts literals and keeps the highlight aligned', () => {
            const sql =
                "SELECT o.customer_id\n   FROM orders o WHERE o.email = 'secret@example.com'";
            const start = sql.indexOf('customer_id');
            const snippet = buildUsageSnippet(sql, start, start + 11, 'postgres');
            expect(snippet.text).toBe("SELECT o.customer_id FROM orders o WHERE o.email = '?'");
            expect(snippet).toMatchObject({
                before: 'SELECT o.',
                match: 'customer_id',
                after: " FROM orders o WHERE o.email = '?'",
                truncatedStart: false,
                truncatedEnd: false,
            });
            expect(snippet.text).not.toContain('secret');
        });

        it('marks cut ends with an ellipsis', () => {
            const sql = `${'x, '.repeat(40)}customer_id${', y'.repeat(40)}`;
            const start = sql.indexOf('customer_id');
            const snippet = buildUsageSnippet(sql, start, start + 11, 'postgres', 10);
            expect(snippet.text.startsWith('… ')).toBe(true);
            expect(snippet.text.endsWith(' …')).toBe(true);
            expect(snippet).toMatchObject({
                match: 'customer_id',
                truncatedStart: true,
                truncatedEnd: true,
            });
            expect(snippet.text).toBe(`… ${snippet.before}${snippet.match}${snippet.after} …`);
        });

        it('keeps comments, and the values in them, out of the excerpt', () => {
            const cases: [string, 'postgres' | 'mysql'][] = [
                [
                    "SELECT customer_id FROM public.orders WHERE email = 'a@b.com' /* card 4111111111111111 */ AND id = 42",
                    'postgres',
                ],
                [
                    'SELECT customer_id FROM orders -- ticket 4111111111111111\nWHERE id = 1',
                    'postgres',
                ],
                ['SELECT customer_id FROM orders # card 4111111111111111\nWHERE 1=1', 'mysql'],
                ['/* owner jane@example.com */ SELECT customer_id FROM orders', 'postgres'],
                ['SELECT customer_id FROM orders /* unterminated 4111111111111111', 'postgres'],
            ];
            for (const [sql, dialect] of cases) {
                const start = sql.indexOf('customer_id');
                const snippet = buildUsageSnippet(sql, start, start + 11, dialect);
                expect(snippet.match).toBe('customer_id');
                expect(snippet.text).not.toMatch(/4111|@|card|ticket|owner|unterminated/);
            }
        });

        it('never cuts the window inside a word', () => {
            const sql =
                'CREATE OR REPLACE VIEW big_orders AS SELECT id, customer_id, total FROM orders o WHERE total > 100';
            const start = sql.indexOf('customer_id');
            const snippet = buildUsageSnippet(sql, start, start + 11, 'postgres', 20);
            expect(snippet.text).toBe('… AS SELECT id, customer_id, total FROM orders …');
            expect(snippet.match).toBe('customer_id');
        });

        it('highlights the placeholder when the match is itself a literal', () => {
            const sql = "EXECUTE 'UPDATE orders SET customer_id = 1'";
            const start = sql.indexOf("'");
            const snippet = buildUsageSnippet(sql, start, sql.length, 'postgres');
            expect(snippet.text).toBe("EXECUTE '?'");
            expect(snippet).toMatchObject({before: 'EXECUTE ', match: "'?'", after: ''});
        });
    });
});
