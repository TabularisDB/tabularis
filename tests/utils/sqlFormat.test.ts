import {describe, it, expect} from 'vitest';
import {formatSql, toFormatterLanguage} from '@/utils/sqlFormat';
import {resolveSqlSyntax} from '@/utils/sqlSyntax';
import {GOOGLESQL} from '../fixtures/sql-syntax/googlesql';

describe('sqlFormat', () => {
    describe('toFormatterLanguage', () => {
        it('maps postgres to postgresql', () => {
            expect(toFormatterLanguage('postgres')).toBe('postgresql');
        });

        it('maps mysql to mysql', () => {
            expect(toFormatterLanguage('mysql')).toBe('mysql');
        });

        it('maps mssql to transactsql', () => {
            expect(toFormatterLanguage('mssql')).toBe('transactsql');
        });

        it('maps sqlite to sqlite', () => {
            expect(toFormatterLanguage('sqlite')).toBe('sqlite');
        });

        it('maps oracle to plsql', () => {
            expect(toFormatterLanguage('oracle')).toBe('plsql');
        });

        it('uses the formatter a declared syntax names', () => {
            expect(toFormatterLanguage(GOOGLESQL)).toBe('bigquery');
        });

        it('maps a resolved preset like its dialect name', () => {
            for (const dialect of [
                'postgres',
                'mysql',
                'mssql',
                'sqlite',
                'oracle',
                'generic',
                undefined,
            ] as const) {
                expect(
                    toFormatterLanguage(
                        resolveSqlSyntax(dialect ? ({sql_dialect: dialect} as never) : null),
                    ),
                ).toBe(toFormatterLanguage(dialect));
            }
        });

        it('treats bigquery as an unknown dialect name', () => {
            expect(toFormatterLanguage('bigquery')).toBe('sql');
        });

        it('falls back to sql for the generic dialect', () => {
            expect(toFormatterLanguage('generic')).toBe('sql');
        });

        it('falls back to sql for an undefined dialect', () => {
            expect(toFormatterLanguage(undefined)).toBe('sql');
        });
    });

    describe('formatSql', () => {
        it('returns an empty string unchanged', () => {
            expect(formatSql('')).toBe('');
        });

        it('returns whitespace-only input unchanged', () => {
            expect(formatSql('   \n\t ')).toBe('   \n\t ');
        });

        it('upper-cases keywords', () => {
            expect(formatSql('select 1')).toContain('SELECT');
        });

        it('breaks a dense one-liner into multiple lines', () => {
            const ugly = 'select a,b from t where a=1 and b=2';
            const pretty = formatSql(ugly);
            expect(pretty).not.toBe(ugly);
            expect(pretty.split('\n').length).toBeGreaterThan(1);
        });

        it('formats without throwing for every supported dialect', () => {
            const query = 'select id, name from users where active = 1';
            for (const dialect of [
                'postgres',
                'mysql',
                'mssql',
                'sqlite',
                'oracle',
                'generic',
            ] as const) {
                const pretty = formatSql(query, dialect);
                expect(pretty).toContain('SELECT');
                expect(pretty).toContain('FROM');
            }
        });

        it('returns the original text when the formatter cannot parse it', () => {
            // sql-formatter throws a parse error on an unterminated expression;
            // formatSql must swallow it and hand back the untouched input.
            const broken = 'SELECT (';
            expect(formatSql(broken)).toBe(broken);
        });
    });
});
