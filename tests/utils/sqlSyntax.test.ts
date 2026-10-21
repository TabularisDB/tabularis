import {describe, it, expect, vi} from 'vitest';
import {supportedDialects} from 'sql-formatter';
import type {DriverCapabilities} from '@/types/plugins';
import {
    dialectOptions,
    scanNonCodeSpans,
    splitBatches,
    splitStatements,
    type Dialect,
} from '@/utils/sqlSplitter';
import {
    SQL_SYNTAX_FORMATTERS,
    SQL_SYNTAX_LIMITS,
    isValidSyntaxWord,
    resolveSqlSyntax,
    syntaxKeywords,
} from '@/utils/sqlSyntax';
import {GOOGLESQL, GOOGLESQL_CAPS, GOOGLESQL_DESCRIPTOR} from '../fixtures/sql-syntax/googlesql';

const PRESETS: readonly Dialect[] = ['postgres', 'mysql', 'mssql', 'sqlite', 'oracle', 'generic'];

const caps = (fields: Partial<Record<string, unknown>>): DriverCapabilities =>
    ({identifier_quote: '"', ...fields}) as DriverCapabilities;

// SQL that exercises every preset rule: quotes, escapes, comments, dollar
// quotes, DELIMITER, GO, `/`, PL/SQL blocks and q-quotes.
const CORPUS: readonly string[] = [
    'SELECT 1; SELECT \'a;b\'; SELECT "c;d"',
    "SELECT 'it''s'; SELECT 'a\\';b'; SELECT `x;y` FROM t",
    '-- c;\nSELECT 1 # x;\n; /* a; /* b; */ c; */ SELECT 2',
    "SELECT 1--1; SELECT E'\\';x'; SELECT $tag$;$tag$; SELECT [a;b]",
    'DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//\nDELIMITER ;\nSELECT 3;',
    'SELECT 1\nGO\nSELECT 2;\nGO 3\n',
    "BEGIN\n  NULL;\nEND;\n/\nSELECT q'[a;b]' FROM dual;",
    "SELECT r'a;b', '''x;y''' FROM t; /*! SET x=1 */; SELECT 1",
];

describe('sqlSyntax', () => {
    describe('resolveSqlSyntax without sql_syntax', () => {
        it('returns the exact preset of sql_dialect', () => {
            for (const dialect of PRESETS) {
                const syntax = resolveSqlSyntax(caps({sql_dialect: dialect}));
                expect(syntax.options).toBe(dialectOptions(dialect));
                expect(syntax.dialect).toBe(dialect);
                expect(syntax.declared).toBe(false);
                expect(syntax.likeEscape).toBe(true);
                expect(syntax.stringEscape).toBe(dialect === 'mysql' ? 'mysql' : 'standard');
                expect(syntax.booleanLiterals).toBeUndefined();
                expect(syntax.keywords).toEqual([]);
                expect(syntax.functions).toEqual([]);
            }
        });

        it('defaults an undeclared dialect to postgres splitting and no dialect', () => {
            for (const driver of [null, undefined, caps({})]) {
                const syntax = resolveSqlSyntax(driver);
                expect(syntax.options).toBe(dialectOptions('postgres'));
                expect(syntax.dialect).toBeUndefined();
                expect(syntax.formatter).toBe('sql');
            }
            const unknown = resolveSqlSyntax(caps({sql_dialect: 'bigquery'}));
            expect(unknown.options).toBe(dialectOptions('generic'));
            expect(unknown.dialect).toBeUndefined();
        });

        it('is cached, so it is as stable as the dialect string', () => {
            expect(resolveSqlSyntax(caps({sql_dialect: 'mysql'}))).toBe(
                resolveSqlSyntax(caps({sql_dialect: 'mysql'})),
            );
            expect(resolveSqlSyntax(GOOGLESQL_CAPS)).toBe(GOOGLESQL);
            expect(resolveSqlSyntax({...GOOGLESQL_CAPS})).toBe(GOOGLESQL);
            const manifest = {id: 'bq', capabilities: GOOGLESQL_CAPS} as never;
            expect(resolveSqlSyntax(manifest)).toBe(GOOGLESQL);
        });

        it('splits and scans byte-identically to the dialect name', () => {
            const names: (Dialect | undefined)[] = [...PRESETS, undefined];
            for (const dialect of names) {
                const syntax = resolveSqlSyntax(dialect ? caps({sql_dialect: dialect}) : null);
                for (const sql of CORPUS) {
                    expect(splitStatements(sql, syntax)).toEqual(splitStatements(sql, dialect));
                    expect(splitBatches(sql, syntax)).toEqual(splitBatches(sql, dialect));
                    expect(scanNonCodeSpans(sql, syntax)).toEqual(scanNonCodeSpans(sql, dialect));
                }
            }
        });
    });

    describe('the GoogleSQL descriptor', () => {
        it('rebuilds the former hard-coded GoogleSQL splitter preset', () => {
            // The preset the host shipped before GoogleSQL became plugin data.
            expect(GOOGLESQL.options).toEqual({
                quotes: [
                    {open: "'", close: "'", escape: '\\', doubleClose: false, kind: 'string'},
                    {open: '"', close: '"', escape: '\\', doubleClose: false, kind: 'string'},
                    {open: '`', close: '`', escape: '\\', doubleClose: false, kind: 'identifier'},
                ],
                eString: false,
                dollarQuoting: false,
                customDelimiter: false,
                goDelimiter: false,
                slashDelimiter: false,
                plsqlBlocks: false,
                qQuoting: false,
                lineComments: true,
                blockComments: true,
                hashComments: true,
                executableComments: false,
                nestedBlockComments: false,
                lineCommentRequiresSpace: false,
                tripleQuotedStrings: true,
                stringPrefixes: ['r', 'b', 'rb', 'br'],
                scriptBlocks: true,
            });
        });

        it('resolves literal style, LIKE, formatter and words', () => {
            // `extends: generic` wins over the `mysql` legacy fallback.
            expect(GOOGLESQL.dialect).toBe('generic');
            expect(GOOGLESQL.declared).toBe(true);
            expect(GOOGLESQL.stringEscape).toBe('backslash');
            expect(GOOGLESQL.likeEscape).toBe(false);
            expect(GOOGLESQL.booleanLiterals).toBe('keywords');
            expect(GOOGLESQL.formatter).toBe('bigquery');
            expect(GOOGLESQL.keywords).toEqual(GOOGLESQL_DESCRIPTOR.keywords);
            expect(GOOGLESQL.functions).toEqual(GOOGLESQL_DESCRIPTOR.functions);
        });

        it('splits a GoogleSQL script through the declarative path', () => {
            const sql = [
                'DECLARE x INT64 DEFAULT 0;',
                'BEGIN',
                '  SET x = x + 1; # bump;',
                '  IF x > 0 THEN SELECT r\'a\\\';b\', """c;\nd"""; END IF;',
                'EXCEPTION WHEN ERROR THEN SELECT @@error.message;',
                'END;',
                'SELECT `p.d.t;x` FROM t',
            ].join('\n');
            expect(splitStatements(sql, GOOGLESQL).map((s) => s.text)).toEqual([
                'DECLARE x INT64 DEFAULT 0',
                sql.slice(sql.indexOf('BEGIN'), sql.lastIndexOf('END;') + 3),
                'SELECT `p.d.t;x` FROM t',
            ]);
            // The mysql fallback alone splits inside the block.
            expect(splitStatements(sql, 'mysql').length).toBeGreaterThan(3);
        });
    });

    describe('declared overrides', () => {
        it('reads boolean_literals and drops an invalid value', () => {
            const resolved = (value: unknown) =>
                resolveSqlSyntax(
                    caps({sql_dialect: 'mysql', sql_syntax: {boolean_literals: value} as never}),
                ).booleanLiterals;
            expect(resolved('keywords')).toBe('keywords');
            expect(resolved('numeric')).toBe('numeric');
            for (const invalid of ['KEYWORDS', 'words', true, 1, null, ['keywords']]) {
                expect(resolved(invalid), JSON.stringify(invalid)).toBeUndefined();
            }
            // Declaring other fields only leaves booleans undeclared.
            expect(
                resolveSqlSyntax(caps({sql_dialect: 'postgres', sql_syntax: {hash_comments: true}}))
                    .booleanLiterals,
            ).toBeUndefined();
        });

        it('extends sql_dialect by default and the named preset otherwise', () => {
            const onMysql = resolveSqlSyntax(
                caps({sql_dialect: 'mysql', sql_syntax: {triple_quoted_strings: true}}),
            );
            expect(onMysql.dialect).toBe('mysql');
            expect(onMysql.options).toEqual({
                ...dialectOptions('mysql'),
                tripleQuotedStrings: true,
            });
            expect(onMysql.stringEscape).toBe('mysql');
            expect(onMysql.formatter).toBe('mysql');

            const onPostgres = resolveSqlSyntax(
                caps({sql_dialect: 'mysql', sql_syntax: {extends: 'postgres'}}),
            );
            expect(onPostgres.options).toEqual(dialectOptions('postgres'));
            expect(onPostgres.stringEscape).toBe('standard');
        });

        it('ignores an unknown extends and keeps sql_dialect', () => {
            const syntax = resolveSqlSyntax(
                caps({
                    sql_dialect: 'sqlite',
                    sql_syntax: {extends: 'bigquery', hash_comments: true},
                }),
            );
            expect(syntax.dialect).toBe('sqlite');
            expect(syntax.options).toEqual({...dialectOptions('sqlite'), hashComments: true});
        });

        it("never weakens the mysql preset's literal escaping", () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const viaExtends = resolveSqlSyntax(
                    caps({sql_syntax: {extends: 'mysql', string_escape: 'standard'}}),
                );
                expect(viaExtends.stringEscape).toBe('mysql');
                const viaDialect = resolveSqlSyntax(
                    caps({sql_dialect: 'mysql', sql_syntax: {string_escape: 'standard'}}),
                );
                expect(viaDialect.stringEscape).toBe('mysql');
                expect(warn).toHaveBeenCalled();
                // "backslash" escapes backslashes too, so it is kept.
                expect(
                    resolveSqlSyntax(
                        caps({sql_dialect: 'mysql', sql_syntax: {string_escape: 'backslash'}}),
                    ).stringEscape,
                ).toBe('backslash');
                // A standard base can still declare standard.
                expect(
                    resolveSqlSyntax(
                        caps({sql_dialect: 'postgres', sql_syntax: {string_escape: 'standard'}}),
                    ).stringEscape,
                ).toBe('standard');
            } finally {
                warn.mockRestore();
            }
        });

        it('drops invalid fields one by one', () => {
            const syntax = resolveSqlSyntax(
                caps({
                    sql_dialect: 'postgres',
                    sql_syntax: {
                        hash_comments: 'yes',
                        dollar_quoting: false,
                        string_escape: 'mysql',
                        like_escape: 0,
                        formatter: '<script>',
                        string_prefixes: ['raw'],
                        keywords: ['OK', 'DROP TABLE x;'],
                        functions: ['FN', 'FN'],
                        quotes: [{open: '{', kind: 'string'}],
                    },
                }),
            );
            expect(syntax.options).toEqual({...dialectOptions('postgres'), dollarQuoting: false});
            expect(syntax.stringEscape).toBe('standard');
            expect(syntax.likeEscape).toBe(true);
            expect(syntax.formatter).toBe('postgresql');
            expect(syntax.keywords).toEqual([]);
            expect(syntax.functions).toEqual(['FN']);
        });

        it('ignores a sql_syntax that is not an object', () => {
            for (const value of ['googlesql', 42, ['x'], null]) {
                const syntax = resolveSqlSyntax(caps({sql_dialect: 'mysql', sql_syntax: value}));
                expect(syntax).toBe(resolveSqlSyntax(caps({sql_dialect: 'mysql'})));
            }
        });

        it('validates quote rules', () => {
            const quotesOf = (quotes: unknown) =>
                resolveSqlSyntax(caps({sql_dialect: 'generic', sql_syntax: {quotes}})).options
                    .quotes;
            expect(
                quotesOf([
                    {open: "'", kind: 'string', escape: 'both'},
                    {open: '[', close: ']', kind: 'identifier', escape: 'none'},
                ]),
            ).toEqual([
                {open: "'", close: "'", kind: 'string', doubleClose: true, escape: '\\'},
                {open: '[', close: ']', kind: 'identifier', doubleClose: false},
            ]);
            const generic = dialectOptions('generic').quotes;
            for (const invalid of [
                [],
                "'",
                [{open: "'"}],
                [{open: "'", kind: 'comment'}],
                [{open: "'", kind: 'string', close: '"'}],
                [{open: "'", kind: 'string', escape: 'quote'}],
                [
                    {open: "'", kind: 'string'},
                    {open: "'", kind: 'string'},
                ],
                Array(SQL_SYNTAX_LIMITS.maxQuotes + 1).fill({open: "'", kind: 'string'}),
            ]) {
                expect(quotesOf(invalid)).toBe(generic);
            }
        });

        it('bounds string prefixes and words', () => {
            const prefixesOf = (string_prefixes: unknown) =>
                resolveSqlSyntax(caps({sql_syntax: {string_prefixes}})).options.stringPrefixes;
            expect(prefixesOf(['R', 'r', 'Rb'])).toEqual(['r', 'rb']);
            expect(prefixesOf(['r1'])).toEqual([]);
            expect(prefixesOf(Array(SQL_SYNTAX_LIMITS.maxStringPrefixes + 1).fill('r'))).toEqual(
                [],
            );

            for (const word of [
                'QUALIFY',
                'FOR SYSTEM_TIME AS OF',
                'SAFE.',
                '_x$1',
                'LANGUAGE js',
            ]) {
                expect(isValidSyntaxWord(word)).toBe(true);
            }
            for (const word of [
                '',
                '1ST',
                'TRAILING ',
                'TWO  SPACES',
                "QUOTE'",
                'A'.repeat(65),
                1,
            ]) {
                expect(isValidSyntaxWord(word)).toBe(false);
            }
            const tooMany = Array(SQL_SYNTAX_LIMITS.maxWords + 1).fill('K');
            expect(resolveSqlSyntax(caps({sql_syntax: {keywords: tooMany}})).keywords).toEqual([]);
        });

        it('only accepts formatter languages sql-formatter supports', () => {
            for (const language of SQL_SYNTAX_FORMATTERS) {
                expect(supportedDialects).toContain(language);
            }
            expect(
                resolveSqlSyntax(caps({sql_dialect: 'mssql', sql_syntax: {formatter: 'duckdb'}}))
                    .formatter,
            ).toBe('duckdb');
        });
    });

    describe('syntaxKeywords', () => {
        const BASE = ['SELECT', 'FROM', 'IF'] as const;

        it('returns the base list when nothing is declared', () => {
            expect(syntaxKeywords(BASE, resolveSqlSyntax(caps({sql_dialect: 'mysql'})))).toBe(BASE);
            expect(syntaxKeywords(BASE, resolveSqlSyntax(null))).toBe(BASE);
        });

        it('appends declared keywords and functions without duplicates', () => {
            const keywords = syntaxKeywords(BASE, GOOGLESQL);
            expect(keywords.slice(0, BASE.length)).toEqual([...BASE]);
            for (const kw of [
                'QUALIFY',
                'PIVOT',
                'UNPIVOT',
                'TABLESAMPLE SYSTEM',
                'UNNEST',
                'MERGE',
                'SAFE_CAST',
                'SAFE.',
                'STRUCT',
                'ARRAY',
                'EXCEPT',
                'REPLACE',
                'REGEXP_CONTAINS',
                'JSON_VALUE',
                'ST_DISTANCE',
                'APPROX_COUNT_DISTINCT',
                'DATE_TRUNC',
                'TIMESTAMP_DIFF',
            ]) {
                expect(keywords).toContain(kw);
            }
            expect(new Set(keywords).size).toBe(keywords.length);
        });
    });
});
