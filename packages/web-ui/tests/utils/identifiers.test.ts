import {describe, it, expect} from 'vitest';
import {
    getQuoteChar,
    quoteIdentifier,
    quoteIdentifierWith,
    quoteTableRef,
    formatSqlIdentifier,
    identifierNeedsQuoting,
    quoteIdentifierIfNeeded,
    shouldQuoteIdentifiers,
} from '@/utils/identifiers';
import type {PluginManifest} from '@/types/plugins';

/** Minimal PluginManifest fixture for a postgres-dialect plugin registered
 * under a non-"postgres" id (issue #614's exact scenario). */
function pluginManifest(overrides: Partial<PluginManifest['capabilities']> = {}): PluginManifest {
    return {
        id: 'postgresql',
        name: 'PostgreSQL',
        version: '1.0.0',
        description: '',
        default_port: 5432,
        capabilities: {
            schemas: true,
            views: true,
            routines: true,
            file_based: false,
            folder_based: false,
            identifier_quote: '"',
            alter_primary_key: true,
            sql_dialect: 'postgres',
            ...overrides,
        },
    };
}

describe('shouldQuoteIdentifiers', () => {
    it('returns true for the bare "postgres" string (legacy path)', () => {
        expect(shouldQuoteIdentifiers('postgres')).toBe(true);
    });

    it('returns true for the bare "postgresql" string — no capabilities object, so the literal fallback covers the shipped plugin id too (PR #588)', () => {
        expect(shouldQuoteIdentifiers('postgresql')).toBe(true);
    });

    it('returns true for a manifest/capabilities object declaring sql_dialect: "postgres"', () => {
        expect(shouldQuoteIdentifiers(pluginManifest())).toBe(true);
        expect(shouldQuoteIdentifiers(pluginManifest().capabilities)).toBe(true);
    });

    it('returns true when sql_dialect is omitted entirely (defaults to postgres per the manifest schema)', () => {
        const {sql_dialect, ...withoutDialect} = pluginManifest().capabilities;
        expect(shouldQuoteIdentifiers(withoutDialect)).toBe(true);
    });

    it('returns false for sql_dialect: "sqlite" — must not flip on identifier_quote alone, which sqlite shares with postgres', () => {
        expect(shouldQuoteIdentifiers(pluginManifest({sql_dialect: 'sqlite'}))).toBe(false);
    });

    it('returns false for sql_dialect: "mysql"', () => {
        expect(shouldQuoteIdentifiers(pluginManifest({sql_dialect: 'mysql'}))).toBe(false);
    });
});

describe('getQuoteChar', () => {
    it('should return backtick for mysql', () => {
        expect(getQuoteChar('mysql')).toBe('`');
    });

    it('should return backtick for mariadb', () => {
        expect(getQuoteChar('mariadb')).toBe('`');
    });

    it('should return double quote for postgres', () => {
        expect(getQuoteChar('postgres')).toBe('"');
    });

    it('should return double quote for sqlite', () => {
        expect(getQuoteChar('sqlite')).toBe('"');
    });

    it('should return double quote for null driver', () => {
        expect(getQuoteChar(null)).toBe('"');
    });

    it('should return double quote for undefined driver', () => {
        expect(getQuoteChar(undefined)).toBe('"');
    });

    it('should return double quote for unknown driver', () => {
        expect(getQuoteChar('oracle')).toBe('"');
    });

    it('should read identifier_quote off a PluginManifest for a non-"postgres" plugin id', () => {
        expect(getQuoteChar(pluginManifest())).toBe('"');
    });
});

describe('quoteIdentifier', () => {
    it('should quote with backticks for mysql', () => {
        expect(quoteIdentifier('my_table', 'mysql')).toBe('`my_table`');
    });

    it('should quote with double quotes for postgres', () => {
        expect(quoteIdentifier('my_table', 'postgres')).toBe('"my_table"');
    });

    it('should quote with double quotes for sqlite', () => {
        expect(quoteIdentifier('my_table', 'sqlite')).toBe('"my_table"');
    });

    it('should escape backticks inside mysql identifiers', () => {
        expect(quoteIdentifier('my`table', 'mysql')).toBe('`my``table`');
    });

    it('should escape double quotes inside postgres identifiers', () => {
        expect(quoteIdentifier('my"table', 'postgres')).toBe('"my""table"');
    });

    it('should handle empty string', () => {
        expect(quoteIdentifier('', 'mysql')).toBe('``');
        expect(quoteIdentifier('', 'postgres')).toBe('""');
    });

    it('should handle identifiers with spaces', () => {
        expect(quoteIdentifier('my table', 'mysql')).toBe('`my table`');
        expect(quoteIdentifier('my table', 'postgres')).toBe('"my table"');
    });

    it('should handle identifiers with special characters', () => {
        expect(quoteIdentifier('table-name.v2', 'postgres')).toBe('"table-name.v2"');
    });

    it('quotes identically for a "postgresql" plugin manifest and the bare "postgres" string', () => {
        expect(quoteIdentifier('my_table', pluginManifest())).toBe(
            quoteIdentifier('my_table', 'postgres'),
        );
    });

    it('should close a bracket quote with ] and double a ] in the name', () => {
        const brackets = pluginManifest({identifier_quote: '[', sql_dialect: 'mssql'});
        expect(quoteIdentifier('my table', brackets)).toBe('[my table]');
        expect(quoteIdentifier('a]b', brackets)).toBe('[a]]b]');
        // `[` needs no escaping inside a bracket-quoted name.
        expect(quoteIdentifier('a[b', brackets)).toBe('[a[b]');
    });
});

describe('quoteIdentifierWith', () => {
    it('should wrap with a symmetric quote and double it inside the name', () => {
        expect(quoteIdentifierWith('my col', '"')).toBe('"my col"');
        expect(quoteIdentifierWith('we"ird', '"')).toBe('"we""ird"');
        expect(quoteIdentifierWith('we`ird', '`')).toBe('`we``ird`');
        // Only the active quote is doubled.
        expect(quoteIdentifierWith('a`b"c', '"')).toBe('"a`b""c"');
    });

    it('should close a bracket quote with ] and double only ]', () => {
        expect(quoteIdentifierWith('my col', '[')).toBe('[my col]');
        expect(quoteIdentifierWith('a]b', '[')).toBe('[a]]b]');
        expect(quoteIdentifierWith('a[b', '[')).toBe('[a[b]');
    });

    it('should match quoteIdentifier for the resolved quote char', () => {
        const brackets = pluginManifest({identifier_quote: '[', sql_dialect: 'mssql'});
        for (const driver of ['mysql', 'postgres', brackets]) {
            expect(quoteIdentifierWith('x]y`z"', getQuoteChar(driver))).toBe(
                quoteIdentifier('x]y`z"', driver),
            );
        }
    });
});

describe('quoteTableRef', () => {
    it('should return just quoted table when no schema', () => {
        expect(quoteTableRef('users', 'postgres')).toBe('"users"');
    });

    it('should return schema-qualified reference when schema is provided', () => {
        expect(quoteTableRef('users', 'postgres', 'public')).toBe('"public"."users"');
    });

    it('should use backticks for mysql schema-qualified reference', () => {
        expect(quoteTableRef('users', 'mysql', 'mydb')).toBe('`mydb`.`users`');
    });

    it('should return just quoted table when schema is null', () => {
        expect(quoteTableRef('users', 'postgres', null)).toBe('"users"');
    });

    it('should return just quoted table when schema is undefined', () => {
        expect(quoteTableRef('users', 'postgres', undefined)).toBe('"users"');
    });

    it('should return just quoted table when schema is empty string', () => {
        expect(quoteTableRef('users', 'postgres', '')).toBe('"users"');
    });

    it('should escape special chars in both schema and table', () => {
        expect(quoteTableRef('my"table', 'postgres', 'my"schema')).toBe('"my""schema"."my""table"');
    });

    it('produces the same schema-qualified reference for a "postgresql" plugin manifest as for the bare "postgres" string', () => {
        expect(quoteTableRef('users', pluginManifest(), 'public')).toBe(
            quoteTableRef('users', 'postgres', 'public'),
        );
    });
});

describe('formatSqlIdentifier', () => {
    it('should not quote plain lowercase identifiers for postgres', () => {
        expect(formatSqlIdentifier('users', 'postgres')).toBe('users');
        expect(formatSqlIdentifier('user_status', 'postgres')).toBe('user_status');
    });

    it('should quote mixed case identifiers for postgres', () => {
        expect(formatSqlIdentifier('Status', 'postgres')).toBe('"Status"');
        expect(formatSqlIdentifier('AccountEventLog', 'postgres')).toBe('"AccountEventLog"');
        expect(formatSqlIdentifier('AccountId', 'postgres')).toBe('"AccountId"');
    });

    it('should quote identifiers for postgresql driver ids', () => {
        expect(formatSqlIdentifier('AccountId', 'postgresql')).toBe('"AccountId"');
        expect(formatSqlIdentifier('user', 'postgresql')).toBe('"user"');
    });

    it('should quote identifiers for PostgreSQL plugin manifests', () => {
        const manifest = {id: 'postgresql'} as PluginManifest;

        expect(formatSqlIdentifier('AccountId', manifest)).toBe('"AccountId"');
    });

    it('should quote reserved words for postgres', () => {
        expect(formatSqlIdentifier('select', 'postgres')).toBe('"select"');
        expect(formatSqlIdentifier('user', 'postgres')).toBe('"user"');
        expect(formatSqlIdentifier('table', 'postgres')).toBe('"table"');
    });

    it('should quote identifiers with special characters or spaces for postgres', () => {
        expect(formatSqlIdentifier('my table', 'postgres')).toBe('"my table"');
        expect(formatSqlIdentifier('table-name', 'postgres')).toBe('"table-name"');
    });

    it('should leave identifiers unchanged for mysql', () => {
        expect(formatSqlIdentifier('Status', 'mysql')).toBe('Status');
        expect(formatSqlIdentifier('user_status', 'mariadb')).toBe('user_status');
        expect(formatSqlIdentifier('AccountEventLog', 'mysql')).toBe('AccountEventLog');
        expect(formatSqlIdentifier('select', 'mysql')).toBe('select');
    });

    it('should leave identifiers unchanged for sqlite and unknown drivers', () => {
        expect(formatSqlIdentifier('Status', 'sqlite')).toBe('Status');
        expect(formatSqlIdentifier('Status', null)).toBe('Status');
        expect(formatSqlIdentifier('users', 'sqlite')).toBe('users');
        expect(formatSqlIdentifier('AccountEventLog', 'sqlite')).toBe('AccountEventLog');
    });
    it('quotes mixed-case identifiers identically for a "postgresql" plugin manifest and the bare "postgres" string', () => {
        expect(formatSqlIdentifier('AccountEventLog', pluginManifest())).toBe(
            formatSqlIdentifier('AccountEventLog', 'postgres'),
        );
    });

    it('leaves identifiers unchanged for a plugin manifest declaring a non-postgres dialect', () => {
        expect(formatSqlIdentifier('Status', pluginManifest({sql_dialect: 'mysql'}))).toBe(
            'Status',
        );
    });
});

describe('identifierNeedsQuoting', () => {
    it('should not flag plain identifiers in any dialect', () => {
        for (const driver of ['mysql', 'mariadb', 'postgres', 'sqlite']) {
            expect(identifierNeedsQuoting('users', driver)).toBe(false);
            expect(identifierNeedsQuoting('order_items', driver)).toBe(false);
            expect(identifierNeedsQuoting('_tmp2', driver)).toBe(false);
        }
    });

    it('should flag hyphens, spaces and other special characters in every dialect', () => {
        for (const driver of ['mysql', 'mariadb', 'postgres', 'sqlite']) {
            expect(identifierNeedsQuoting('global-conf_modulos', driver)).toBe(true);
            expect(identifierNeedsQuoting('order items', driver)).toBe(true);
            expect(identifierNeedsQuoting('price€', driver)).toBe(true);
            expect(identifierNeedsQuoting('a.b', driver)).toBe(true);
        }
    });

    it('should flag names starting with a digit', () => {
        expect(identifierNeedsQuoting('2fa_codes', 'mysql')).toBe(true);
        expect(identifierNeedsQuoting('2fa_codes', 'postgres')).toBe(true);
    });

    it('should flag reserved words whatever their case', () => {
        expect(identifierNeedsQuoting('order', 'mysql')).toBe(true);
        expect(identifierNeedsQuoting('Order', 'mysql')).toBe(true);
        expect(identifierNeedsQuoting('key', 'mariadb')).toBe(true);
        expect(identifierNeedsQuoting('group', 'sqlite')).toBe(true);
        expect(identifierNeedsQuoting('user', 'postgres')).toBe(true);
    });

    it.each([
        ['groups', 'mysql'],
        ['system', 'mysql'],
        ['lead', 'mariadb'],
        ['rank', 'mysql'],
        ['window', 'mysql'],
        ['transaction', 'sqlite'],
        ['commit', 'sqlite'],
        ['only', 'postgres'],
        ['some', 'postgres'],
    ])('should flag %s, reserved on %s', (word, driver) => {
        expect(identifierNeedsQuoting(word, driver)).toBe(true);
    });

    it('should flag words reserved on SQL Server and Oracle for those plugins', () => {
        const mssql = pluginManifest({identifier_quote: '[', sql_dialect: 'mssql'});
        expect(identifierNeedsQuoting('view', mssql)).toBe(true);
        expect(identifierNeedsQuoting('top', mssql)).toBe(true);
        // Upper case is what Oracle folds to, so only the reserved list catches these.
        const oracle = pluginManifest({sql_dialect: 'oracle'});
        expect(identifierNeedsQuoting('COMMENT', oracle)).toBe(true);
        expect(identifierNeedsQuoting('LEVEL', oracle)).toBe(true);
        expect(identifierNeedsQuoting('DATE', oracle)).toBe(true);
    });

    it('should not flag common names that no supported dialect reserves', () => {
        for (const driver of ['mysql', 'postgres', 'sqlite']) {
            for (const name of ['name', 'status', 'type', 'time', 'timestamp', 'email', 'text']) {
                expect(identifierNeedsQuoting(name, driver)).toBe(false);
            }
        }
    });

    it('should flag mixed case on postgres only, where unquoted names fold to lower case', () => {
        expect(identifierNeedsQuoting('AccountEventLog', 'postgres')).toBe(true);
        expect(identifierNeedsQuoting('AccountEventLog', 'postgresql')).toBe(true);
        expect(identifierNeedsQuoting('AccountEventLog', 'mysql')).toBe(false);
        expect(identifierNeedsQuoting('AccountEventLog', 'sqlite')).toBe(false);
    });

    it('should follow sql_dialect for plugin capabilities', () => {
        const caps = pluginManifest().capabilities;
        expect(identifierNeedsQuoting('AccountEventLog', caps)).toBe(true);
        expect(identifierNeedsQuoting('AccountEventLog', {...caps, sql_dialect: 'mysql'})).toBe(
            false,
        );
        expect(identifierNeedsQuoting('AccountEventLog', {...caps, sql_dialect: 'generic'})).toBe(
            false,
        );
    });

    it('should flag non-upper-case names on an oracle-dialect plugin', () => {
        const oracle = pluginManifest({sql_dialect: 'oracle'});
        expect(identifierNeedsQuoting('EMPLOYEES', oracle)).toBe(false);
        expect(identifierNeedsQuoting('employees', oracle)).toBe(true);
        expect(identifierNeedsQuoting('Employees', oracle)).toBe(true);
    });

    it('should not flag an empty identifier', () => {
        expect(identifierNeedsQuoting('', 'mysql')).toBe(false);
    });
});

describe('quoteIdentifierIfNeeded', () => {
    it('should quote names that need it with the dialect quote (issue #1260)', () => {
        expect(quoteIdentifierIfNeeded('global-conf_modulos', 'mariadb')).toBe(
            '`global-conf_modulos`',
        );
        expect(quoteIdentifierIfNeeded('global-conf_modulos', 'mysql')).toBe(
            '`global-conf_modulos`',
        );
        expect(quoteIdentifierIfNeeded('global-conf_modulos', 'postgres')).toBe(
            '"global-conf_modulos"',
        );
        expect(quoteIdentifierIfNeeded('global-conf_modulos', 'sqlite')).toBe(
            '"global-conf_modulos"',
        );
    });

    it('should leave plain names unchanged', () => {
        expect(quoteIdentifierIfNeeded('users', 'mysql')).toBe('users');
        expect(quoteIdentifierIfNeeded('users', 'postgres')).toBe('users');
        expect(quoteIdentifierIfNeeded('Users', 'sqlite')).toBe('Users');
    });

    it('should escape embedded quote characters like quoteIdentifier', () => {
        expect(quoteIdentifierIfNeeded('it`s', 'mysql')).toBe('`it``s`');
        expect(quoteIdentifierIfNeeded('say "hi"', 'postgres')).toBe('"say ""hi"""');
    });

    it("should use a plugin's identifier_quote", () => {
        expect(quoteIdentifierIfNeeded('my table', pluginManifest({identifier_quote: '`'}))).toBe(
            '`my table`',
        );
    });
});
