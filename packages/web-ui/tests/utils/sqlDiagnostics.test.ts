import {describe, it, expect} from 'vitest';
import {
    diagnoseParsedSelect,
    parseSelectStatement,
    relationKey,
    type RelationLookup,
    type SqlDiagnostic,
} from '@/utils/sqlDiagnostics';

type Catalog = Record<string, string[] | 'missing' | 'unknown'>;

const catalog: Catalog = {
    orders: ['id', 'customer_id', 'total', 'created_at'],
    customers: ['id', 'name', 'email'],
    'public.orders': ['id', 'customer_id', 'total', 'created_at'],
    'Mixed Case': ['Id', 'Value'],
    mystery: 'unknown',
    ghost: 'missing',
};

// Runs the full pipeline against an in-memory catalog; keys are `name` or `schema.name`.
function diagnose(sql: string, extra: Catalog = {}): SqlDiagnostic[] {
    const parsed = parseSelectStatement(sql);
    if (!parsed) return [];
    const all = {...catalog, ...extra};
    const lookups = new Map<string, RelationLookup>();
    for (const {schema, name} of parsed.relations) {
        const entry = all[schema ? `${schema}.${name}` : name] ?? 'missing';
        lookups.set(
            relationKey(schema, name),
            entry === 'missing' || entry === 'unknown'
                ? {status: entry}
                : {status: 'found', columns: entry},
        );
    }
    return diagnoseParsedSelect(parsed, lookups);
}

const errors = (sql: string, extra?: Catalog) =>
    diagnose(sql, extra)
        .filter((d) => d.severity === 'error')
        .map((d) => `${d.code}:${d.name}`);

const textOf = (sql: string, d: SqlDiagnostic) => sql.slice(d.start, d.end);

describe('sqlDiagnostics', () => {
    describe('parseSelectStatement', () => {
        it('ignores statements outside the SELECT subset', () => {
            expect(parseSelectStatement('UPDATE orders SET total = 1')).toBeNull();
            expect(parseSelectStatement('WITH x AS (SELECT 1) DELETE FROM orders')).toBeNull();
            expect(parseSelectStatement('CREATE TABLE t (id int)')).toBeNull();
            expect(parseSelectStatement('')).toBeNull();
        });

        it('gives up on unterminated strings, quoted identifiers and comments', () => {
            expect(parseSelectStatement("SELECT 'abc FROM orders")).toBeNull();
            expect(parseSelectStatement('SELECT "abc FROM orders')).toBeNull();
            expect(parseSelectStatement('SELECT 1 /* open')).toBeNull();
        });

        it('lists each relation a query names once', () => {
            const parsed = parseSelectStatement(
                'SELECT * FROM public.orders o JOIN customers c ON c.id = o.customer_id JOIN customers c2 ON true',
            );
            expect(parsed?.relations).toEqual([
                {schema: 'public', name: 'orders'},
                {schema: undefined, name: 'customers'},
            ]);
        });

        it('does not list CTE names as relations', () => {
            const parsed = parseSelectStatement('WITH x AS (SELECT 1 AS a) SELECT a FROM x');
            expect(parsed?.relations).toEqual([]);
        });
    });

    describe('unresolved columns', () => {
        it('flags a misspelled qualified column on its identifier', () => {
            const sql = 'SELECT o.custmer_id FROM public.orders o';
            const found = diagnose(sql);
            expect(found).toHaveLength(1);
            expect(found[0]).toMatchObject({code: 'unresolvedColumn', severity: 'error'});
            expect(found[0].name).toBe('o.custmer_id');
            expect(textOf(sql, found[0])).toBe('custmer_id');
        });

        it('flags a misspelled unqualified column', () => {
            const sql = 'SELECT total, totl FROM orders';
            expect(errors(sql)).toEqual(['unresolvedColumn:totl']);
        });

        it('accepts every known column in all clauses', () => {
            expect(
                errors(
                    `SELECT o.id, total FROM orders o
                     WHERE o.customer_id > 1 AND created_at IS NOT NULL
                     GROUP BY o.id, total HAVING sum(total) > 10
                     ORDER BY o.created_at DESC LIMIT 5`,
                ),
            ).toEqual([]);
        });

        it('is case-insensitive for unquoted identifiers', () => {
            expect(errors('SELECT O.ID, TOTAL FROM Orders O')).toEqual([]);
        });
    });

    describe('quoted identifiers', () => {
        it('matches quoted identifiers exactly', () => {
            expect(errors('SELECT "Id", "Value" FROM "Mixed Case"')).toEqual([]);
            expect(errors('SELECT "id" FROM "Mixed Case"')).toEqual(['unresolvedColumn:id']);
        });

        it('folds an unquoted identifier to lower case before comparing', () => {
            expect(errors('SELECT Id FROM "Mixed Case"')).toEqual(['unresolvedColumn:id']);
        });

        it('unescapes doubled quotes', () => {
            expect(errors('SELECT "a""b" FROM t', {t: ['a"b']})).toEqual([]);
        });
    });

    describe('aliases', () => {
        it('flags an unknown qualifier on the qualifier itself', () => {
            const sql = 'SELECT x.id FROM orders o';
            const found = diagnose(sql);
            expect(found[0]).toMatchObject({code: 'unresolvedAlias', severity: 'error', name: 'x'});
            expect(textOf(sql, found[0])).toBe('x');
        });

        it('hides the table name once it is aliased', () => {
            expect(errors('SELECT orders.id FROM orders o')).toEqual(['unresolvedAlias:orders']);
        });

        it('allows the table name when there is no alias', () => {
            expect(errors('SELECT orders.id FROM public.orders')).toEqual([]);
            expect(errors('SELECT public.orders.id FROM public.orders')).toEqual([]);
        });

        it('lets an inner alias shadow an outer one', () => {
            const sql = `SELECT o.id FROM orders o
                WHERE EXISTS (SELECT 1 FROM customers o WHERE o.email IS NOT NULL AND o.total > 1)`;
            expect(errors(sql)).toEqual(['unresolvedColumn:o.total']);
        });

        it('resolves correlated references against the outer query', () => {
            const sql = `SELECT c.name FROM customers c
                WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)`;
            expect(errors(sql)).toEqual([]);
            expect(
                errors(
                    `SELECT 1 FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.idd)`,
                ),
            ).toEqual(['unresolvedColumn:c.idd']);
        });

        it('accepts a bare alias as a whole-row reference', () => {
            expect(errors('SELECT o FROM orders o')).toEqual([]);
        });

        it('applies a column alias list', () => {
            expect(errors('SELECT t.a, t.b FROM orders AS t(a, b)')).toEqual([]);
            expect(errors('SELECT t.id FROM orders AS t(a, b)')).toEqual(['unresolvedColumn:t.id']);
        });
    });

    describe('ambiguous names', () => {
        it('flags a column present in two sources', () => {
            const sql = 'SELECT id FROM orders o JOIN customers c ON c.id = o.customer_id';
            const found = diagnose(sql);
            expect(found[0]).toMatchObject({
                code: 'ambiguousColumn',
                severity: 'error',
                name: 'id',
            });
        });

        it('accepts a qualified name and a name unique to one source', () => {
            expect(
                errors('SELECT o.id, email FROM orders o JOIN customers c ON c.id = o.customer_id'),
            ).toEqual([]);
        });

        it('does not flag a USING column as ambiguous', () => {
            expect(errors('SELECT id FROM orders JOIN customers USING (id)')).toEqual([]);
        });

        it('flags a self-join without qualifiers', () => {
            expect(errors('SELECT total FROM orders a JOIN orders b ON a.id = b.id')).toEqual([
                'ambiguousColumn:total',
            ]);
        });
    });

    describe('SELECT *', () => {
        it('expands * and alias.* through a derived table', () => {
            expect(errors('SELECT d.total FROM (SELECT * FROM orders) d')).toEqual([]);
            expect(errors('SELECT d.nope FROM (SELECT o.* FROM orders o) d')).toEqual([
                'unresolvedColumn:d.nope',
            ]);
        });

        it('accepts alias.* only for a known alias', () => {
            expect(errors('SELECT o.* FROM orders o')).toEqual([]);
            expect(errors('SELECT z.* FROM orders o')).toEqual(['unresolvedAlias:z']);
        });

        it('does not flag columns of a derived table whose * could not be expanded', () => {
            expect(errors('SELECT d.anything FROM (SELECT * FROM mystery) d')).toEqual([]);
        });
    });

    describe('CTEs and derived tables', () => {
        it('resolves columns of a CTE from its output names', () => {
            const sql = `WITH recent AS (SELECT id, total AS amount FROM orders)
                SELECT r.amount, r.id FROM recent r`;
            expect(errors(sql)).toEqual([]);
            expect(errors(sql.replace('r.amount', 'r.total'))).toEqual([
                'unresolvedColumn:r.total',
            ]);
        });

        it('lets a later CTE read an earlier one', () => {
            const sql = `WITH a AS (SELECT id FROM orders), b AS (SELECT id, nope FROM a)
                SELECT * FROM b`;
            expect(errors(sql)).toEqual(['unresolvedColumn:nope']);
        });

        it('applies an explicit CTE column list', () => {
            expect(
                errors('WITH c (x, y) AS (SELECT id, total FROM orders) SELECT x, y FROM c'),
            ).toEqual([]);
            expect(
                errors('WITH c (x, y) AS (SELECT id, total FROM orders) SELECT id FROM c'),
            ).toEqual(['unresolvedColumn:id']);
        });

        it('prefers a CTE over a same-named table', () => {
            expect(
                errors('WITH orders AS (SELECT 1 AS only_col) SELECT only_col FROM orders'),
            ).toEqual([]);
        });

        it('treats a recursive CTE self-reference as unknown', () => {
            const sql = `WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 5)
                SELECT n FROM t`;
            expect(errors(sql)).toEqual([]);
        });

        it('does not flag columns of a derived table with unnamed expressions', () => {
            expect(errors('SELECT d.whatever FROM (SELECT count(*) FROM orders) d')).toEqual([]);
        });

        it('checks the body of a derived table', () => {
            expect(errors('SELECT d.id FROM (SELECT o.idd AS id FROM orders o) d')).toEqual([
                'unresolvedColumn:o.idd',
            ]);
        });

        it('lets a LATERAL subquery read its FROM siblings', () => {
            const sql = `SELECT c.name, l.total FROM customers c,
                LATERAL (SELECT total FROM orders o WHERE o.customer_id = c.id) l`;
            expect(errors(sql)).toEqual([]);
        });

        it('hides FROM siblings from a plain derived table', () => {
            const sql = `SELECT 1 FROM customers c, (SELECT total FROM orders o WHERE o.customer_id = c.id) d`;
            expect(errors(sql)).toEqual(['unresolvedAlias:c']);
        });
    });

    describe('set operations', () => {
        it('checks each operand and takes ORDER BY names from the first', () => {
            expect(
                errors('SELECT id AS k FROM orders UNION SELECT id FROM customers ORDER BY k'),
            ).toEqual([]);
            expect(
                errors('SELECT id AS k FROM orders UNION SELECT id FROM customers ORDER BY id'),
            ).toEqual(['unresolvedColumn:id']);
            expect(errors('SELECT id FROM orders UNION SELECT idd FROM customers')).toEqual([
                'unresolvedColumn:idd',
            ]);
        });
    });

    describe('output names in ORDER BY and GROUP BY', () => {
        it('accepts a select-list alias there, but not in WHERE', () => {
            expect(errors('SELECT total * 2 AS doubled FROM orders ORDER BY doubled')).toEqual([]);
            expect(errors('SELECT total * 2 AS doubled FROM orders GROUP BY doubled')).toEqual([]);
            expect(errors('SELECT total * 2 AS doubled FROM orders WHERE doubled > 1')).toEqual([
                'unresolvedColumn:doubled',
            ]);
        });

        it('accepts an implicit select-list alias', () => {
            expect(errors('SELECT total t2 FROM orders ORDER BY t2')).toEqual([]);
        });
    });

    describe('relations', () => {
        it('warns, not errors, about a relation missing from the metadata', () => {
            const sql = 'SELECT * FROM ghost';
            const found = diagnose(sql);
            expect(found).toHaveLength(1);
            expect(found[0]).toMatchObject({
                code: 'unresolvedRelation',
                severity: 'warning',
                name: 'ghost',
            });
            expect(textOf(sql, found[0])).toBe('ghost');
        });

        it('covers the schema in the range of a qualified relation', () => {
            const sql = 'SELECT * FROM audit.ghost';
            const found = diagnose(sql, {'audit.ghost': 'missing'});
            expect(textOf(sql, found[0])).toBe('audit.ghost');
        });

        it('does not cascade column errors from a missing relation', () => {
            expect(errors('SELECT g.anything FROM ghost g')).toEqual([]);
        });

        it('reports an info limitation when columns are not available', () => {
            const found = diagnose('SELECT m.x FROM mystery m');
            expect(found).toHaveLength(1);
            expect(found[0]).toMatchObject({
                code: 'metadataUnavailable',
                severity: 'info',
                name: 'mystery',
            });
        });
    });

    describe('limits of the analysis', () => {
        it('never flags references against a table function, and says so', () => {
            const found = diagnose(
                "SELECT g.x, value FROM generate_series(1, 3) AS g(x), json_each('{}') j",
            );
            expect(found.filter((d) => d.severity === 'error')).toEqual([]);
            expect(
                found.filter((d) => d.code === 'unsupportedConstruct').map((d) => d.name),
            ).toEqual(['generate_series(…)', 'json_each(…)']);
        });

        it('reports NATURAL JOIN and skips ambiguity', () => {
            const found = diagnose('SELECT id FROM orders NATURAL JOIN customers');
            expect(found.map((d) => d.code)).toEqual(['unsupportedConstruct']);
        });

        it('reports VALUES and TABLESAMPLE sources', () => {
            expect(
                diagnose('SELECT v.a FROM (VALUES (1), (2)) AS v(a)').map((d) => d.name),
            ).toEqual(['VALUES']);
            expect(
                diagnose('SELECT total FROM orders TABLESAMPLE SYSTEM (10)').map((d) => d.name),
            ).toEqual(['TABLESAMPLE']);
        });

        it('stops short of a cross-database name', () => {
            const found = diagnose('SELECT x.anything FROM other_db.public.orders x');
            expect(found.filter((d) => d.severity === 'error')).toEqual([]);
            expect(found.map((d) => d.code)).toEqual(['unsupportedConstruct']);
        });

        it('treats PostgreSQL syntax around expressions as non-references', () => {
            const sql = `SELECT o.id::text AS s, o.total::numeric(10, 2), CAST(o.total AS double precision),
                    date '2024-01-01', interval '1 day', extract(epoch FROM o.created_at),
                    o.created_at AT TIME ZONE 'UTC', o.total IS DISTINCT FROM 1,
                    count(*) FILTER (WHERE o.total > 1), array_agg(o.id ORDER BY o.id),
                    row_number() OVER (PARTITION BY o.customer_id ORDER BY o.created_at),
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY o.total),
                    CASE WHEN o.total > 1 THEN 'big' ELSE 'small' END label,
                    o.total BETWEEN 1 AND 2, ARRAY[1, 2], current_date, $1, :param
                FROM orders o
                WHERE o.created_at > now() - interval '7 days' AND o.id = ANY(ARRAY[1, 2])
                ORDER BY 1 NULLS LAST
                LIMIT 10 OFFSET 5`;
            expect(diagnose(sql)).toEqual([]);
        });

        it('does not read text inside strings or comments as references', () => {
            const sql = `SELECT 'nope.nope', "id" -- nope.nope
                /* nope.nope */ FROM orders o WHERE o.id = $$nope.nope$$`;
            expect(errors(sql, {orders: ['id']})).toEqual([]);
        });

        it('skips a select list that has no FROM yet (draft)', () => {
            expect(diagnose('SELECT o.custmer_id')).toEqual([]);
            expect(diagnose('SELECT o.custmer_id FROM')).toEqual([]);
        });

        it('analyzes a draft that ends mid-clause', () => {
            expect(errors('SELECT o.custmer_id FROM orders o WHERE')).toEqual([
                'unresolvedColumn:o.custmer_id',
            ]);
            expect(errors('SELECT o.id FROM orders o JOIN customers c ON c.id =')).toEqual([]);
        });
    });
});
