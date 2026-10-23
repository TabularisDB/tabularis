import {describe, it, expect} from 'vitest';
import {
    booleanLiteralWithStyle,
    declaredBooleanLiterals,
    quoteSqlString,
    sqlBooleanLiteral,
    quoteSqlStringWithStyle,
    stringEscapeStyle,
    supportsLikeEscape,
} from '@/utils/sqlLiteral';
import {GOOGLESQL_CAPS} from '../../../../tests/fixtures/sql-syntax/googlesql';
import stringLiterals from '../../../../tests/fixtures/sql-syntax/string-literals.json';
import type {StringEscapeStyle} from '@/utils/sqlSyntax';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';

const caps = (sql_dialect?: DriverCapabilities['sql_dialect']): DriverCapabilities =>
    ({identifier_quote: '`', sql_dialect}) as DriverCapabilities;

describe('sqlLiteral', () => {
    describe('stringEscapeStyle', () => {
        it('maps built-in driver ids', () => {
            expect(stringEscapeStyle('mysql')).toBe('mysql');
            expect(stringEscapeStyle('mariadb')).toBe('mysql');
            expect(stringEscapeStyle('postgres')).toBe('standard');
            expect(stringEscapeStyle('bigquery')).toBe('standard');
            expect(stringEscapeStyle(null)).toBe('standard');
            expect(stringEscapeStyle(undefined)).toBe('standard');
        });

        it('reads sql_dialect from capabilities and manifests', () => {
            expect(stringEscapeStyle(caps('mysql'))).toBe('mysql');
            expect(stringEscapeStyle(caps('postgres'))).toBe('standard');
            expect(stringEscapeStyle(caps('generic'))).toBe('standard');
        });

        it('reads a declared sql_syntax string_escape over the dialect', () => {
            expect(stringEscapeStyle(GOOGLESQL_CAPS)).toBe('backslash');
            const manifest = {id: 'bq', capabilities: GOOGLESQL_CAPS} as PluginManifest;
            expect(stringEscapeStyle(manifest)).toBe('backslash');
            const standardMysql = {
                ...caps('mysql'),
                sql_syntax: {string_escape: 'standard'},
            } as DriverCapabilities;
            // "standard" would stop doubling backslashes on a MySQL engine: the
            // mysql preset's style is kept.
            expect(stringEscapeStyle(standardMysql)).toBe('mysql');
            // An invalid value keeps the preset's style.
            const invalid = {...caps('mysql'), sql_syntax: {string_escape: 'mysql'}} as never;
            expect(stringEscapeStyle(invalid)).toBe('mysql');
        });

        it('falls back to the driver id when no dialect is declared', () => {
            expect(stringEscapeStyle(caps(), 'mariadb')).toBe('mysql');
            expect(stringEscapeStyle(caps('generic'), 'mysql')).toBe('mysql');
            expect(stringEscapeStyle(caps(), 'informix')).toBe('standard');
            // A concrete dialect decides over the id.
            expect(stringEscapeStyle(caps('postgres'), 'mariadb')).toBe('standard');
        });

        it('falls back to the manifest id when no dialect is declared', () => {
            expect(stringEscapeStyle({id: 'mariadb', capabilities: caps()} as PluginManifest)).toBe(
                'mysql',
            );
            expect(stringEscapeStyle(caps())).toBe('standard');
        });
    });

    describe('quoteSqlString', () => {
        it('doubles quotes for standard dialects', () => {
            expect(quoteSqlString("O'Brien \\ x", 'postgres')).toBe("'O''Brien \\ x'");
        });

        it('also doubles backslashes for mysql', () => {
            expect(quoteSqlString("O'Brien \\ x", 'mysql')).toBe("'O''Brien \\\\ x'");
        });

        it('backslash-escapes quotes, backslashes and line breaks for a backslash syntax', () => {
            expect(quoteSqlString("O'Brien \\ x\r\ny", GOOGLESQL_CAPS)).toBe(
                "'O\\'Brien \\\\ x\\r\\ny'",
            );
            expect(quoteSqlString('', GOOGLESQL_CAPS)).toBe("''");
            expect(quoteSqlStringWithStyle("a'\\", 'backslash')).toBe("'a\\'\\\\'");
        });

        it('writes NUL as \\0 in a backslash syntax', () => {
            expect(quoteSqlStringWithStyle('a\0b', 'backslash')).toBe("'a\\0b'");
            expect(quoteSqlStringWithStyle('\\\0', 'backslash')).toBe("'\\\\\\0'");
        });

        it('writes NUL as \\0 for mysql, like the Rust dump side', () => {
            expect(quoteSqlStringWithStyle('a\0b', 'mysql')).toBe("'a\\0b'");
            expect(quoteSqlString("O'\\\0", 'mysql')).toBe("'O''\\\\\\0'");
        });

        it('matches the shared Rust quote_string_literal cases', () => {
            const cases = stringLiterals.cases as {
                style: StringEscapeStyle;
                input: string;
                expected: string;
            }[];
            expect(cases.length).toBeGreaterThan(0);
            for (const {style, input, expected} of cases) {
                expect(
                    quoteSqlStringWithStyle(input, style),
                    `${style}: ${JSON.stringify(input)}`,
                ).toBe(expected);
            }
        });
    });

    describe('supportsLikeEscape', () => {
        it('is true unless a declared syntax turns it off', () => {
            for (const driver of ['postgres', 'mysql', null, undefined, caps('mysql'), caps()]) {
                expect(supportsLikeEscape(driver)).toBe(true);
            }
            expect(supportsLikeEscape(GOOGLESQL_CAPS)).toBe(false);
        });
    });

    describe('boolean literals', () => {
        const declaring = (boolean_literals: 'keywords' | 'numeric'): DriverCapabilities =>
            ({...caps('mysql'), sql_syntax: {boolean_literals}}) as DriverCapabilities;

        it('spells each style', () => {
            expect(booleanLiteralWithStyle(true, 'keywords')).toBe('TRUE');
            expect(booleanLiteralWithStyle(false, 'keywords')).toBe('FALSE');
            expect(booleanLiteralWithStyle(true, 'numeric')).toBe('1');
            expect(booleanLiteralWithStyle(false, 'numeric')).toBe('0');
        });

        it('is undeclared for built-in ids and capabilities without the field', () => {
            for (const driver of [
                'postgres',
                'mysql',
                'sqlite',
                null,
                undefined,
                caps('mysql'),
                caps('postgres'),
            ]) {
                expect(declaredBooleanLiterals(driver)).toBeUndefined();
                // The historical TRUE/FALSE.
                expect(sqlBooleanLiteral(true, driver)).toBe('TRUE');
                expect(sqlBooleanLiteral(false, driver)).toBe('FALSE');
            }
        });

        it('follows a declared style, also through a manifest', () => {
            expect(declaredBooleanLiterals(GOOGLESQL_CAPS)).toBe('keywords');
            expect(sqlBooleanLiteral(true, GOOGLESQL_CAPS)).toBe('TRUE');
            expect(sqlBooleanLiteral(true, declaring('numeric'))).toBe('1');
            expect(sqlBooleanLiteral(false, declaring('numeric'))).toBe('0');
            const manifest = {id: 'p', capabilities: declaring('numeric')} as PluginManifest;
            expect(sqlBooleanLiteral(false, manifest)).toBe('0');
        });
    });
});
