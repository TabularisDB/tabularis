import {describe, expect, it} from 'vitest';
import {canStripSqlComments, stripSqlComments} from '@/utils/stripSqlComments';
import {resolveSqlSyntax} from '@/utils/sqlSyntax';
import {GOOGLESQL} from '../../../../tests/fixtures/sql-syntax/googlesql';

describe('stripSqlComments', () => {
    it('removes a line comment and keeps the SQL', () => {
        expect(stripSqlComments('SELECT 1 -- trailing\n', 'postgres')).toBe('SELECT 1 \n');
    });

    it('removes a block comment', () => {
        expect(stripSqlComments('SELECT /* note */ 1', 'postgres')).toBe('SELECT  1');
    });

    it('inserts a space so stripping does not merge adjacent tokens', () => {
        expect(stripSqlComments('SELECT a/**/b', 'postgres')).toBe('SELECT a b');
    });

    it('does not add a space when a neighbour is already whitespace', () => {
        expect(stripSqlComments('SELECT a /**/ b', 'postgres')).toBe('SELECT a  b');
    });

    it('preserves string literals that look like comments', () => {
        expect(stripSqlComments("SELECT '-- not a comment'", 'postgres')).toBe(
            "SELECT '-- not a comment'",
        );
        expect(stripSqlComments("SELECT '/* not a comment */'", 'postgres')).toBe(
            "SELECT '/* not a comment */'",
        );
    });

    it('preserves quoted identifiers containing comment markers', () => {
        expect(stripSqlComments('SELECT "a -- b" FROM t', 'postgres')).toBe(
            'SELECT "a -- b" FROM t',
        );
    });

    it('preserves dollar-quoted bodies', () => {
        const sql = 'SELECT $tag$ -- keep /* this */ $tag$';
        expect(stripSqlComments(sql, 'postgres')).toBe(sql);
    });

    it('keeps MySQL executable comments but strips plain block comments', () => {
        expect(stripSqlComments('SELECT /*! STRAIGHT_JOIN */ /* drop */ 1', 'mysql')).toBe(
            'SELECT /*! STRAIGHT_JOIN */  1',
        );
    });

    it('keeps MariaDB /*M! ... */ conditional comments', () => {
        const sql = 'SELECT /*M!50000 1 */ 2';
        expect(stripSqlComments(sql, 'mysql')).toBe(sql);
    });

    it('treats MySQL `#` as a line comment', () => {
        expect(stripSqlComments('SELECT 1 # tail\nSELECT 2', 'mysql')).toBe('SELECT 1 \nSELECT 2');
    });

    it('keeps `--` as subtraction in MySQL when no space follows', () => {
        expect(stripSqlComments('SELECT 1--1', 'mysql')).toBe('SELECT 1--1');
    });

    it('strips `--1` as a comment in Postgres (no space required)', () => {
        expect(stripSqlComments('SELECT 1--1\n', 'postgres')).toBe('SELECT 1\n');
    });

    it('handles nested block comments in Postgres', () => {
        expect(stripSqlComments('SELECT /* a /* b */ c */ 1', 'postgres')).toBe('SELECT  1');
    });

    it('removes multiline block comments', () => {
        expect(stripSqlComments('SELECT\n/* a\nb\nc */\n1', 'postgres')).toBe('SELECT\n1');
    });

    it('strips an unterminated block comment to the end of the input', () => {
        expect(stripSqlComments('SELECT 1 /* unterminated', 'postgres')).toBe('SELECT 1 ');
    });

    it('keeps optimizer hints in block form', () => {
        const sql = 'SELECT /*+ INDEX(t idx) */ * FROM t /* note */';
        for (const dialect of ['mysql', 'oracle', 'postgres'] as const) {
            expect(stripSqlComments(sql, dialect)).toBe('SELECT /*+ INDEX(t idx) */ * FROM t ');
        }
    });

    it("keeps Oracle's --+ line hint", () => {
        expect(stripSqlComments('SELECT --+ FULL(t)\n* FROM t -- note\n', 'oracle')).toBe(
            'SELECT --+ FULL(t)\n* FROM t \n',
        );
    });

    it('drops lines that only held comments', () => {
        expect(stripSqlComments('-- header\nSELECT 1;\n-- footer', 'postgres')).toBe('SELECT 1;\n');
        expect(stripSqlComments('SELECT 1;\n  /* a */ -- b\nSELECT 2;', 'postgres')).toBe(
            'SELECT 1;\nSELECT 2;',
        );
    });

    it('keeps blank lines that had no comment', () => {
        expect(stripSqlComments('SELECT 1;\n\nSELECT 2;', 'postgres')).toBe(
            'SELECT 1;\n\nSELECT 2;',
        );
    });

    it('keeps CRLF line endings after a line comment', () => {
        expect(stripSqlComments('SELECT 1 -- a\r\n-- b\r\nSELECT 2\r\n', 'postgres')).toBe(
            'SELECT 1 \r\nSELECT 2\r\n',
        );
    });

    it('accepts a resolved syntax for a built-in driver', () => {
        const mysql = resolveSqlSyntax({sql_dialect: 'mysql'});
        expect(stripSqlComments('SELECT 1 # tail\nSELECT 1--1', mysql)).toBe(
            'SELECT 1 \nSELECT 1--1',
        );
    });

    it("uses a plugin's declared sql_syntax (GoogleSQL)", () => {
        expect(canStripSqlComments(GOOGLESQL)).toBe(true);
        expect(
            stripSqlComments("SELECT '''-- kept\n''' AS a # note\nFROM `p.d.t` -- x\n", GOOGLESQL),
        ).toBe("SELECT '''-- kept\n''' AS a \nFROM `p.d.t` \n");
    });

    it('leaves the text alone when the connection declares no dialect', () => {
        const none = resolveSqlSyntax({});
        const sql = 'SELECT /* note */ 1 -- x';
        expect(canStripSqlComments(none)).toBe(false);
        expect(stripSqlComments(sql, none)).toBe(sql);
        expect(canStripSqlComments(undefined)).toBe(false);
    });

    describe('generic dialect (#1211)', () => {
        // On a backslash-escape engine `'x\'` does not end the string, so the
        // generic rules would read `-- y' AS a, b FROM t` as a comment.
        const sql = "SELECT 'x\\' -- y' AS a, b FROM t -- note";

        it('treats a connection that declares only generic as undeclared', () => {
            const generic = resolveSqlSyntax({sql_dialect: 'generic'});
            expect(canStripSqlComments(generic)).toBe(false);
            expect(stripSqlComments(sql, generic)).toBe(sql);
        });

        it('treats the generic dialect name as undeclared', () => {
            expect(canStripSqlComments('generic')).toBe(false);
            expect(stripSqlComments(sql, 'generic')).toBe(sql);
        });

        it('strips when generic comes with a declared sql_syntax', () => {
            const declared = resolveSqlSyntax({
                sql_dialect: 'generic',
                sql_syntax: {
                    quotes: [{open: "'", kind: 'string', escape: 'backslash'}],
                },
            });
            expect(canStripSqlComments(declared)).toBe(true);
            expect(stripSqlComments(sql, declared)).toBe("SELECT 'x\\' -- y' AS a, b FROM t ");
        });

        it('keeps the action for concrete dialects', () => {
            for (const dialect of ['postgres', 'mysql', 'mssql', 'sqlite', 'oracle'] as const) {
                expect(canStripSqlComments(dialect)).toBe(true);
                expect(canStripSqlComments(resolveSqlSyntax({sql_dialect: dialect}))).toBe(true);
            }
        });
    });

    it('returns the input unchanged for an unknown dialect', () => {
        const sql = 'SELECT /* note */ 1 -- x';
        expect(stripSqlComments(sql, 'nope')).toBe(sql);
    });

    it('returns the input unchanged when no dialect is given', () => {
        const sql = 'SELECT /* note */ 1';
        expect(stripSqlComments(sql)).toBe(sql);
    });

    it('strips comments spanning several statements', () => {
        const sql = 'SELECT 1; -- one\nSELECT 2; /* two */';
        expect(stripSqlComments(sql, 'postgres')).toBe('SELECT 1; \nSELECT 2; ');
    });

    it('leaves comment-free SQL untouched', () => {
        const sql = "SELECT a, b FROM t WHERE c = 'x'";
        expect(stripSqlComments(sql, 'postgres')).toBe(sql);
    });
});
