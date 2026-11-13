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

const mysql = (sql: string, options = {}) =>
    findColumnReferences(sql, ordersNoSchema, {dialect: 'mysql', ...options}).map((m) =>
        m.reason ? `${m.confidence}:${m.reason}` : m.confidence,
    );

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

        it('checks each side of UNION, INTERSECT and EXCEPT against its own tables', () => {
            const union =
                'SELECT customer_id FROM public.orders UNION SELECT customer_id FROM public.archive';
            expect(summary(union, ordersPublic)).toEqual(['parsed']);
            expect(summary(union.replace('UNION', 'UNION ALL'), ordersPublic)).toEqual(['parsed']);
            expect(summary(union.replace('UNION', 'INTERSECT'), ordersPublic)).toEqual(['parsed']);
            expect(summary(union.replace('UNION', 'EXCEPT'), ordersPublic)).toEqual(['parsed']);
            const reversed =
                'SELECT customer_id FROM public.archive UNION SELECT customer_id FROM public.orders';
            expect(summary(reversed, ordersPublic)).toEqual(['parsed']);
            const both =
                'SELECT customer_id FROM public.orders UNION SELECT customer_id FROM public.orders o';
            expect(summary(both, ordersPublic)).toEqual(['parsed', 'parsed']);
            // A join inside one side still makes that side ambiguous.
            const joined =
                'SELECT customer_id FROM public.orders, public.refunds UNION SELECT customer_id FROM public.archive';
            expect(summary(joined, ordersPublic)).toEqual(['uncertain:several-tables']);
            // Inside a subquery and inside a derived table, with or without
            // parentheses around each side; `d.customer_id` stays a derived-table read.
            const nested =
                'SELECT name FROM customers WHERE id IN (SELECT customer_id FROM public.orders UNION SELECT customer_id FROM public.archive)';
            expect(summary(nested, ordersPublic)).toEqual(['parsed']);
            const derived =
                'SELECT d.customer_id FROM (SELECT customer_id FROM public.orders UNION SELECT customer_id FROM public.archive) d';
            expect(summary(derived, ordersPublic)).toEqual(['uncertain:derived-table', 'parsed']);
            const wrapped =
                'SELECT d.customer_id FROM ((SELECT customer_id FROM public.orders) UNION (SELECT customer_id FROM public.archive)) d';
            expect(summary(wrapped, ordersPublic)).toEqual(['uncertain:derived-table', 'parsed']);
            // A join group in parentheses is still read as one.
            const group =
                'SELECT o.customer_id FROM ((public.orders o JOIN public.archive a ON a.id = o.id))';
            expect(summary(group, ordersPublic)).toEqual(['parsed']);
            // A correlated reference from the second side still reaches the outer query.
            const correlated =
                'SELECT id FROM public.orders o WHERE EXISTS (SELECT 1 FROM public.archive UNION SELECT 1 FROM public.refunds r WHERE r.cid = customer_id)';
            const refunds = (ref: RelationRef) =>
                ref.name === 'refunds' || ref.name === 'archive' ? ['id', 'cid'] : undefined;
            expect(summary(correlated, ordersPublic, {columnsOf: refunds})).toEqual(['parsed']);
            // Oracle's MINUS splits the same way.
            expect(
                findColumnReferences(
                    'SELECT customer_id FROM shop.orders MINUS SELECT customer_id FROM shop.archive',
                    {schema: 'SHOP', table: 'ORDERS', column: 'CUSTOMER_ID'},
                    {dialect: 'oracle'},
                ).map((m) => m.confidence),
            ).toEqual(['parsed']);
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

        it('compares table and schema names the way the dialect stores them', () => {
            // PostgreSQL folds unquoted names to lower case and keeps quoted ones.
            expect(summary('SELECT CUSTOMER_ID FROM PUBLIC.ORDERS', ordersPublic)).toEqual([
                'parsed',
            ]);
            expect(summary('SELECT o.customer_id FROM "public"."orders" o', ordersPublic)).toEqual([
                'parsed',
            ]);
            expect(summary('SELECT customer_id FROM "PUBLIC".orders', ordersPublic)).toEqual([]);
            expect(summary('SELECT customer_id FROM public."Orders"', ordersPublic)).toEqual([]);
            expect(summary('SELECT "CUSTOMER_ID" FROM public.orders', ordersPublic)).toEqual([]);
            expect(summary('SELECT o.customer_id FROM public."Orders" o', ordersPublic)).toEqual(
                [],
            );
            expect(
                summary('SELECT "PUBLIC".orders.customer_id FROM "PUBLIC".orders', ordersPublic),
            ).toEqual([]);

            // A mixed-case catalog name only matches its quoted spelling.
            const mixed: ColumnUsageTarget = {
                schema: 'Sales',
                table: 'Orders',
                column: 'CustomerId',
            };
            expect(summary('SELECT "CustomerId" FROM "Sales"."Orders"', mixed)).toEqual(['parsed']);
            expect(summary('SELECT CustomerId FROM "Sales"."Orders"', mixed)).toEqual([]);
            expect(summary('SELECT "CustomerId" FROM Sales.Orders', mixed)).toEqual([]);

            // Oracle folds unquoted names to upper case.
            const oracle: ColumnUsageTarget = {
                schema: 'SHOP',
                table: 'ORDERS',
                column: 'CUSTOMER_ID',
            };
            const inOracle = (sql: string) =>
                findColumnReferences(sql, oracle, {dialect: 'oracle'}).map((m) => m.confidence);
            expect(inOracle('select o.customer_id from shop.orders o')).toEqual(['parsed']);
            expect(inOracle('select o."customer_id" from shop.orders o')).toEqual([]);
            expect(inOracle('select o.customer_id from "shop".orders o')).toEqual([]);

            // MySQL column names ignore case; database and table names may not
            // (lower_case_table_names), so another case is uncertain.
            expect(mysql('SELECT CUSTOMER_ID FROM shop.orders')).toEqual(['parsed']);
            expect(mysql('SELECT `Customer_Id` FROM `orders`')).toEqual(['parsed']);
            expect(mysql('SELECT o.CUSTOMER_ID FROM Orders o')).toEqual(['uncertain:name-case']);
            expect(mysql('SELECT customer_id FROM `ORDERS`')).toEqual(['uncertain:name-case']);
            expect(mysql('SELECT customer_id FROM SHOP.orders')).toEqual(['uncertain:name-case']);
            expect(mysql('SELECT Orders.customer_id FROM orders')).toEqual(['parsed']);
            expect(mysql('SELECT customer_id FROM orders o JOIN Orders p ON p.id = o.id')).toEqual([
                'uncertain:several-tables',
            ]);
            expect(mysql('SELECT customer_id FROM shop.invoices')).toEqual([]);

            // SQLite ignores the case of ASCII letters only.
            const dbo: ColumnUsageTarget = {schema: 'dbo', table: 'orders', column: 'customer_id'};
            const inDialect = (dialect: string, sql: string, target = dbo) =>
                findColumnReferences(sql, target, {dialect}).map((m) =>
                    m.reason ? `${m.confidence}:${m.reason}` : m.confidence,
                );
            expect(inDialect('sqlite', 'SELECT "CUSTOMER_ID" FROM "DBO"."Orders"')).toEqual([
                'parsed',
            ]);
            const umlaut: ColumnUsageTarget = {table: 'ä', column: 'id'};
            expect(inDialect('sqlite', 'SELECT id FROM "Ä"', umlaut)).toEqual([]);
            expect(inDialect('sqlite', 'SELECT ID FROM "ä"', umlaut)).toEqual(['parsed']);

            // SQL Server (and a dialect with unknown rules) depends on the
            // collation: another case is uncertain, the exact spelling parses.
            for (const dialect of ['mssql', 'generic']) {
                expect(inDialect(dialect, 'SELECT customer_id FROM dbo.orders')).toEqual([
                    'parsed',
                ]);
                expect(inDialect(dialect, 'SELECT o.customer_id FROM [dbo].[orders] o')).toEqual(
                    dialect === 'mssql' ? ['parsed'] : [],
                );
                expect(inDialect(dialect, 'SELECT customer_id FROM dbo.Orders')).toEqual([
                    'uncertain:name-case',
                ]);
                expect(inDialect(dialect, 'SELECT CUSTOMER_ID FROM dbo.orders')).toEqual([
                    'uncertain:name-case',
                ]);
                expect(inDialect(dialect, 'SELECT o.Customer_Id FROM DBO.orders o')).toEqual([
                    'uncertain:name-case',
                ]);
                expect(inDialect(dialect, 'SELECT customer_id FROM dbo.invoices')).toEqual([]);
            }
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

        it('reads the tables of a parenthesised join, as MySQL stores view bodies', () => {
            expect(
                mysql(
                    'select `o`.`customer_id` AS `customer_id` from (`orders` `o` join `customers` `c` on((`c`.`id` = `o`.`customer_id`)))',
                ),
            ).toEqual(['parsed', 'parsed']);
            expect(
                mysql(
                    'select `o`.`customer_id` from ((`orders` `o` join `customers` `c` on((`c`.`id` = `o`.`customer_id`))) join `refunds` `r` on((`r`.`order_id` = `o`.`id`)))',
                ),
            ).toEqual(['parsed', 'parsed']);
            expect(
                mysql(
                    'select `r`.`customer_id` from ((`customers` `c` join `refunds` `r` on((`r`.`id` = `c`.`id`))) join `orders` `o` on((`o`.`id` = `r`.`id`)))',
                ),
            ).toEqual([]);
            expect(
                summary(
                    'SELECT o.customer_id FROM (public.orders o JOIN customers c ON c.id = o.customer_id)',
                    ordersPublic,
                ),
            ).toEqual(['parsed', 'parsed']);
            expect(mysql('SELECT customer_id FROM (orders, customers)')).toEqual([
                'uncertain:several-tables',
            ]);
            expect(summary('SELECT customer_id FROM (VALUES (1)) v', ordersNoSchema)).toEqual([]);
        });

        it('only reports a * that expands the target table in its own query', () => {
            expect(
                summary(
                    'SELECT * FROM customers WHERE id IN (SELECT id FROM orders)',
                    ordersNoSchema,
                ),
            ).toEqual([]);
            expect(
                summary(
                    'SELECT * FROM customers WHERE EXISTS (SELECT 1 FROM orders o WHERE o.cid = customers.id)',
                    ordersNoSchema,
                ),
            ).toEqual([]);
            expect(
                summary(
                    'SELECT c.id FROM customers c WHERE EXISTS (SELECT * FROM orders o WHERE o.cid = c.id)',
                    ordersNoSchema,
                ),
            ).toEqual([]);
            expect(
                summary('SELECT * FROM (SELECT customer_id FROM orders) d', ordersNoSchema),
            ).toEqual(['parsed']);
            const union = 'SELECT * FROM customers UNION ALL SELECT * FROM orders';
            const matches = findColumnReferences(union, ordersNoSchema, {dialect: 'postgres'});
            expect(matches.map((m) => m.reason)).toEqual(['wildcard']);
            expect(matches[0].start).toBe(union.lastIndexOf('*'));
            expect(summary('SELECT 2 * 3, count(*) FROM orders', ordersNoSchema)).toEqual([]);
        });

        it('finds a * after select items that hold FROM, ORDER BY or CASE', () => {
            for (const sql of [
                'SELECT CASE WHEN a > 1 THEN 1 END AS k, * FROM orders',
                'SELECT EXTRACT(YEAR FROM d) AS y, * FROM orders',
                'SELECT SUBSTRING(x FROM 2) AS s, * FROM orders',
                'SELECT row_number() OVER (ORDER BY id) AS rn, * FROM orders',
                'SELECT CASE WHEN a THEN CASE b WHEN 1 THEN 2 END END, (SELECT max(id) FROM refunds), * FROM orders',
            ]) {
                expect(summary(sql, ordersNoSchema)).toEqual(['uncertain:wildcard']);
            }
            expect(
                summary('SELECT EXTRACT(YEAR FROM d) AS y, * FROM customers', ordersNoSchema),
            ).toEqual([]);
        });

        it('keeps a derived table in extra parentheses a derived table', () => {
            expect(
                summary(
                    'SELECT d.customer_id FROM ((SELECT customer_id FROM orders)) d',
                    ordersNoSchema,
                ),
            ).toEqual(['uncertain:derived-table', 'parsed']);
            expect(
                summary(
                    'SELECT o.customer_id FROM ((orders o JOIN customers c ON c.id = o.cid))',
                    ordersNoSchema,
                ),
            ).toEqual(['parsed']);
        });

        it('recognises * after TOP, ALL, DISTINCT ON and MySQL select modifiers', () => {
            const wildcard = ['uncertain:wildcard'];
            const mssql = (sql: string) =>
                findColumnReferences(sql, ordersNoSchema, {dialect: 'mssql'}).map(
                    (m) => `${m.confidence}:${m.reason}`,
                );
            expect(mssql('SELECT TOP 10 * FROM orders')).toEqual(wildcard);
            expect(mssql('SELECT TOP (5) PERCENT WITH TIES * FROM orders ORDER BY id')).toEqual(
                wildcard,
            );
            expect(mssql('SELECT DISTINCT TOP 3 * FROM orders')).toEqual(wildcard);
            expect(summary('SELECT ALL * FROM orders', ordersNoSchema)).toEqual(wildcard);
            expect(summary('SELECT DISTINCT ON (id) * FROM orders', ordersNoSchema)).toEqual(
                wildcard,
            );
            expect(mysql('SELECT SQL_CALC_FOUND_ROWS * FROM orders')).toEqual(wildcard);
            expect(mysql('SELECT HIGH_PRIORITY SQL_NO_CACHE DISTINCTROW * FROM orders')).toEqual(
                wildcard,
            );
            expect(summary('DELETE FROM orders WHERE id = 1 RETURNING *', ordersNoSchema)).toEqual(
                wildcard,
            );
        });

        it('keeps reading a comma join after an ON or USING clause', () => {
            // x is known not to have the column, so only the comma-joined
            // customers table can make the unqualified column ambiguous.
            const xOnly = (ref: RelationRef) => (ref.name === 'x' ? ['a'] : undefined);
            expect(
                summary(
                    'SELECT customer_id FROM orders o JOIN x ON x.a = o.a, customers c',
                    ordersNoSchema,
                    {columnsOf: xOnly},
                ),
            ).toEqual(['uncertain:several-tables']);
            expect(
                summary(
                    'SELECT customer_id FROM orders o JOIN x USING (a), customers c',
                    ordersNoSchema,
                    {columnsOf: xOnly},
                ),
            ).toEqual(['uncertain:several-tables']);
            const columnsOf = (ref: RelationRef) =>
                ref.name === 'customers'
                    ? ['id']
                    : ref.name === 'orders'
                      ? ['customer_id', 'total']
                      : undefined;
            expect(
                mysql(
                    'INSERT INTO orders (customer_id) SELECT id FROM customers ON DUPLICATE KEY UPDATE customer_id = 7, total = 3',
                    {columnsOf},
                ),
            ).toEqual(['parsed', 'parsed']);
            expect(
                summary(
                    'INSERT INTO orders (customer_id) SELECT id FROM customers ON CONFLICT (id) DO UPDATE SET customer_id = 7, total = 3',
                    ordersNoSchema,
                    {columnsOf},
                ),
            ).toEqual(['parsed', 'parsed']);
        });

        it('reads USING as a table list only in DELETE and MERGE', () => {
            expect(
                summary(
                    "EXECUTE format('INSERT INTO audit VALUES ($1)') USING orders.customer_id",
                    ordersNoSchema,
                ),
            ).toEqual(['uncertain:unresolved-qualifier']);
            expect(
                summary(
                    'DELETE FROM refunds r USING orders o WHERE o.customer_id = r.customer_id',
                    ordersNoSchema,
                ),
            ).toEqual(['parsed']);
            expect(
                summary(
                    'MERGE INTO archive a USING orders o ON a.id = o.id WHEN MATCHED THEN UPDATE SET owner = o.customer_id',
                    ordersNoSchema,
                ),
            ).toEqual(['parsed']);
        });

        it('scopes CTE names to the query after their definition', () => {
            expect(
                summary(
                    'WITH orders AS (SELECT * FROM orders WHERE total > 0) SELECT customer_id FROM orders',
                    ordersNoSchema,
                ),
            ).toEqual(['uncertain:wildcard']);
            expect(
                summary(
                    'WITH orders AS (SELECT customer_id FROM orders) SELECT o.customer_id FROM orders o',
                    ordersNoSchema,
                ),
            ).toEqual(['parsed', 'uncertain:derived-table']);
            expect(
                summary(
                    'WITH RECURSIVE orders AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM orders) SELECT customer_id FROM orders',
                    ordersNoSchema,
                ),
            ).toEqual([]);
            expect(
                summary(
                    'SELECT customer_id FROM orders WHERE id IN (WITH orders AS (SELECT 1 AS id) SELECT id FROM orders)',
                    ordersNoSchema,
                ),
            ).toEqual(['parsed']);
            expect(
                summary(
                    'WITH recent AS (SELECT customer_id FROM orders), orders AS (SELECT 1) SELECT customer_id FROM recent',
                    ordersNoSchema,
                ),
            ).toEqual(['parsed']);
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
        it('redacts numbers written after a dollar sign in every dialect', () => {
            for (const dialect of ['mssql', 'mysql', 'sqlite', 'postgres', undefined] as const) {
                const sql =
                    'SELECT customer_id FROM orders WHERE total > $100.50 AND card = $4111111111111111 OR x = $1';
                const redacted = redactSqlLiterals(sql, dialect);
                expect(redacted).not.toMatch(/[0-9]/);
                const start = sql.indexOf('customer_id');
                const snippet = buildUsageSnippet(sql, start, start + 11, dialect);
                expect(snippet.text).not.toMatch(/[0-9]/);
                expect(snippet.match).toBe('customer_id');
            }
            expect(redactSqlLiterals('SELECT a$1, t$x FROM t', 'mysql')).toBe(
                'SELECT a$1, t$x FROM t',
            );
            expect(redactSqlLiterals('SELECT $tag$4111$tag$', 'postgres')).toBe("SELECT '?'");
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
