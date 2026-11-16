import {describe, expect, it} from 'vitest';
import {resolveSqlSyntax} from '@/utils/sqlSyntax';
import {findStatementAtOffset, splitQueries, splitStatements} from '@/utils/sql';
import type {DriverCapabilities} from '@/types/plugins';

const syntax = resolveSqlSyntax({
    sql_syntax: {extends: 'generic', psql_blocks: true, nested_block_comments: true},
} as DriverCapabilities);

describe('declared Firebird PSQL syntax', () => {
    it.each(['CREATE', 'CREATE OR ALTER', 'ALTER', 'RECREATE'])(
        'preserves %s procedure declarations, branches and CASE expressions',
        (verb) => {
            const body = `${verb} PROCEDURE P RETURNS (N INTEGER) AS
DECLARE VARIABLE X INTEGER;
BEGIN
  X = CASE WHEN 1=1 THEN 2 ELSE 3 END;
  IF (X=2) THEN BEGIN N=X; SUSPEND; END
  ELSE BEGIN N=0; SUSPEND; END
END`;
            expect(splitQueries(`${body}; SELECT 1 FROM RDB$DATABASE;`, syntax)).toEqual([
                body,
                'SELECT 1 FROM RDB$DATABASE',
            ]);
        },
    );

    it.each(['FUNCTION F RETURNS INTEGER', 'TRIGGER T FOR TAB BEFORE INSERT', 'PACKAGE BODY PK'])(
        'preserves %s bodies and quoted END/BEGIN text',
        (header) => {
            const body = `RECREATE ${header} AS BEGIN
/* BEGIN /* END */ END */
X = 'it''s END; BEGIN';
IF (X IS NOT NULL) THEN BEGIN X = NEW."END"; END
END`;
            expect(splitQueries(`${body}; COMMIT;`, syntax)).toEqual([body, 'COMMIT']);
        },
    );

    it('keeps package signatures and all nested implementations together', () => {
        const header = 'CREATE PACKAGE PK AS BEGIN FUNCTION F RETURNS INTEGER; PROCEDURE P; END';
        const body = `RECREATE PACKAGE BODY PK AS BEGIN
FUNCTION F RETURNS INTEGER AS DECLARE X INTEGER; BEGIN X=1; RETURN X; END
PROCEDURE P AS BEGIN IF (1=1) THEN BEGIN EXIT; END END
END`;
        expect(splitQueries(`${header}; ${body}; SELECT 2 FROM RDB$DATABASE;`, syntax)).toEqual([
            header,
            body,
            'SELECT 2 FROM RDB$DATABASE',
        ]);
    });

    it('keeps local subroutines in the declaration section before the main BEGIN', () => {
        const body = `CREATE PROCEDURE P AS
DECLARE FUNCTION F RETURNS INTEGER AS
DECLARE X INTEGER;
BEGIN X=1; RETURN X; END
DECLARE PROCEDURE INNER_P AS BEGIN EXIT; END
BEGIN
  IF (F()=1) THEN BEGIN EXECUTE PROCEDURE INNER_P; END
END`;
        expect(splitQueries(`${body}; COMMIT;`, syntax)).toEqual([body, 'COMMIT']);
    });

    it('supports EXECUTE BLOCK while ordinary transactions and DDL still split', () => {
        const block =
            'EXECUTE BLOCK RETURNS (N INTEGER) AS DECLARE X INTEGER; BEGIN N=1; SUSPEND; END';
        expect(
            splitQueries(
                `BEGIN; ${block}; COMMIT; ALTER TRIGGER T INACTIVE; SELECT CASE WHEN 1=1 THEN 1 END FROM RDB$DATABASE;`,
                syntax,
            ),
        ).toEqual([
            'BEGIN',
            block,
            'COMMIT',
            'ALTER TRIGGER T INACTIVE',
            'SELECT CASE WHEN 1=1 THEN 1 END FROM RDB$DATABASE',
        ]);
    });

    it.each(['^', '!!', '~'])('consumes SET TERM directives with %s as terminator', (term) => {
        const body = 'CREATE PROCEDURE P AS BEGIN X=1; X=2; END';
        const sql = `SET TERM ${term} ; -- client directive\r\n${body}${term}\r\nSET TERM ; ${term}\r\nSELECT 1 FROM RDB$DATABASE;`;
        const statements = splitStatements(sql, syntax);
        expect(statements.map((statement) => statement.text)).toEqual([
            body,
            'SELECT 1 FROM RDB$DATABASE',
        ]);
        const cursor = sql.indexOf('X=2');
        expect(findStatementAtOffset(statements, cursor)?.text).toBe(body);
        expect(sql.slice(statements[0].range.start, statements[0].range.end)).toBe(body);
    });

    it('preserves alternative quoted literals containing quotes, comments and semicolons', () => {
        const body = `EXECUTE BLOCK AS BEGIN X=q'[it's; -- END BEGIN]'; Y=q'{''; /* END */}'; END`;
        expect(splitQueries(`${body}; SELECT 1 FROM RDB$DATABASE;`, syntax)).toEqual([
            body,
            'SELECT 1 FROM RDB$DATABASE',
        ]);
    });

    it('retains an unfinished PSQL unit instead of executing fragments', () => {
        const incomplete = 'CREATE FUNCTION F RETURNS INTEGER AS DECLARE X INTEGER; BEGIN X=1;';
        expect(splitQueries(incomplete, syntax)).toEqual([incomplete]);
    });

    it('requires explicit opt-in and leaves generic SQL unchanged', () => {
        const sql = 'CREATE PROCEDURE P AS BEGIN X=1; X=2; END;';
        expect(splitQueries(sql, 'generic')).toHaveLength(3);
        const disabled = resolveSqlSyntax({sql_syntax: {psql_blocks: false}} as DriverCapabilities);
        expect(splitQueries(sql, disabled)).toEqual(splitQueries(sql, 'generic'));
    });
});
