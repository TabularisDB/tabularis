import {describe, it, expect} from 'vitest';
import {splitQueries} from '@/utils/sqlSplitter';

describe('compound statement bodies', () => {
    describe('SQLite CREATE TRIGGER … BEGIN … END', () => {
        it('keeps the trigger body in one statement', () => {
            const trigger =
                'CREATE TRIGGER audit AFTER INSERT ON orders BEGIN\n' +
                '  INSERT INTO log VALUES (new.id);\n' +
                '  UPDATE stats SET n = n + 1;\n' +
                'END';
            expect(splitQueries(`${trigger};\nSELECT 1;`, 'sqlite')).toEqual([trigger, 'SELECT 1']);
        });

        it('accepts TEMP / TEMPORARY and IF NOT EXISTS', () => {
            for (const head of [
                'CREATE TEMP TRIGGER t',
                'CREATE TEMPORARY TRIGGER t',
                'CREATE TRIGGER IF NOT EXISTS t',
            ]) {
                const sql = `${head} AFTER DELETE ON a BEGIN DELETE FROM b; DELETE FROM c; END; SELECT 1`;
                expect(splitQueries(sql, 'sqlite')).toHaveLength(2);
            }
        });

        it('does not close the body at the END of a CASE expression', () => {
            const trigger =
                "CREATE TRIGGER t AFTER UPDATE ON a BEGIN UPDATE b SET s = CASE WHEN new.x THEN 'y' ELSE 'n' END; DELETE FROM c; END";
            expect(splitQueries(`${trigger}; SELECT 1`, 'sqlite')).toEqual([trigger, 'SELECT 1']);
        });

        it('reads new.end and old.end as columns, not the end of the body', () => {
            const trigger =
                'CREATE TRIGGER t AFTER UPDATE ON a BEGIN UPDATE b SET e = new.end; DELETE FROM c WHERE e = old.end; END';
            expect(splitQueries(`${trigger}; SELECT 1`, 'sqlite')).toEqual([trigger, 'SELECT 1']);
        });

        it('ignores END and semicolons inside strings, identifiers and comments', () => {
            const trigger =
                'CREATE TRIGGER t AFTER INSERT ON a BEGIN INSERT INTO log VALUES (\'END;\'); -- END;\n INSERT INTO "end" VALUES (1); END';
            expect(splitQueries(`${trigger}; SELECT 1`, 'sqlite')).toEqual([trigger, 'SELECT 1']);
        });

        it('still splits transactions and other statements on semicolons', () => {
            expect(splitQueries('BEGIN; INSERT INTO a VALUES (1); END;', 'sqlite')).toEqual([
                'BEGIN',
                'INSERT INTO a VALUES (1)',
                'END',
            ]);
            expect(splitQueries('CREATE TABLE "trigger" (id); SELECT 1', 'sqlite')).toHaveLength(2);
        });

        it('is SQLite only', () => {
            const sql =
                'CREATE TRIGGER t AFTER INSERT ON a BEGIN DELETE FROM b; DELETE FROM c; END';
            expect(splitQueries(sql, 'postgres')).toHaveLength(3);
        });
    });

    describe('PostgreSQL BEGIN ATOMIC … END', () => {
        it('keeps a SQL-standard procedure body in one statement', () => {
            const procedure =
                'CREATE PROCEDURE add_two(a int) LANGUAGE SQL\nBEGIN ATOMIC\n  INSERT INTO t VALUES (a);\n  INSERT INTO t VALUES (a + 1);\nEND';
            expect(splitQueries(`${procedure};\nCALL add_two(1);`, 'postgres')).toEqual([
                procedure,
                'CALL add_two(1)',
            ]);
        });

        it('handles CREATE OR REPLACE FUNCTION with CASE expressions', () => {
            const fn =
                "CREATE OR REPLACE FUNCTION label(n int) RETURNS text LANGUAGE SQL BEGIN ATOMIC SELECT CASE WHEN n > 0 THEN 'pos' END; END";
            expect(splitQueries(`${fn}; SELECT label(1)`, 'postgres')).toEqual([
                fn,
                'SELECT label(1)',
            ]);
        });

        it('allows a comment between BEGIN and ATOMIC', () => {
            const fn =
                'CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN /* standard */ ATOMIC SELECT 1; END';
            expect(splitQueries(`${fn}; SELECT 2`, 'postgres')).toEqual([fn, 'SELECT 2']);
        });

        it('still splits plain transactions and columns named begin and atomic', () => {
            expect(splitQueries('BEGIN; SELECT 1; COMMIT;', 'postgres')).toEqual([
                'BEGIN',
                'SELECT 1',
                'COMMIT',
            ]);
            expect(
                splitQueries('CREATE VIEW v AS SELECT begin, atomic FROM t; SELECT 1', 'postgres'),
            ).toHaveLength(2);
        });

        it('reads `begin atomic` outside a routine as a column and its alias (review)', () => {
            const sql = 'CREATE VIEW review_alias AS SELECT begin atomic FROM t;\nSELECT 1;';
            expect(splitQueries(sql, 'postgres')).toEqual([
                'CREATE VIEW review_alias AS SELECT begin atomic FROM t',
                'SELECT 1',
            ]);
            for (const statement of [
                'CREATE TABLE copy AS SELECT begin atomic FROM t',
                'CREATE MATERIALIZED VIEW mv AS SELECT begin atomic FROM t',
                'CREATE OR REPLACE VIEW v AS SELECT begin atomic FROM t',
            ]) {
                expect(splitQueries(`${statement}; SELECT 1`, 'postgres')).toEqual([
                    statement,
                    'SELECT 1',
                ]);
            }
        });

        it('does not open a body for `begin atomic` inside parentheses in a routine', () => {
            const fn =
                'CREATE FUNCTION f() RETURNS int LANGUAGE SQL RETURN (SELECT begin atomic FROM t LIMIT 1)';
            expect(splitQueries(`${fn}; SELECT 1`, 'postgres')).toEqual([fn, 'SELECT 1']);
        });

        it('leaves dollar-quoted bodies to the dollar-quote rule', () => {
            const fn =
                'CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql';
            expect(splitQueries(`${fn}; SELECT 1`, 'postgres')).toEqual([fn, 'SELECT 1']);
        });
    });
});
