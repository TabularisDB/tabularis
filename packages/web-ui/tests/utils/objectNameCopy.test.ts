import {describe, expect, it} from 'vitest';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {formatColumnNamesAsSqlList, formatObjectNameForCopy} from '@/utils/objectNameCopy';

const baseCapabilities: DriverCapabilities = {
    schemas: true,
    views: true,
    routines: false,
    file_based: false,
    folder_based: false,
    identifier_quote: '"',
    alter_primary_key: false,
};

describe('formatObjectNameForCopy', () => {
    it('leaves a plain name unchanged', () => {
        expect(formatObjectNameForCopy('my"table', 'name', 'postgres', 'public')).toBe('my"table');
    });

    it.each([
        ['postgres', '"my""table"', '"my""schema"."my""table"'],
        ['sqlite', '"my""table"', '"my""schema"."my""table"'],
        ['sqlserver', '"my""table"', '"my""schema"."my""table"'],
    ])('quotes names for %s', (driver, quoted, qualified) => {
        expect(formatObjectNameForCopy('my"table', 'quoted', driver)).toBe(quoted);
        expect(formatObjectNameForCopy('my"table', 'qualified', driver, 'my"schema')).toBe(
            qualified,
        );
    });

    it('escapes backticks for MySQL', () => {
        expect(formatObjectNameForCopy('my`table', 'quoted', 'mysql')).toBe('`my``table`');
        expect(formatObjectNameForCopy('my`table', 'qualified', 'mysql', 'my`schema')).toBe(
            '`my``schema`.`my``table`',
        );
    });

    it('quotes without a schema when none is available', () => {
        expect(formatObjectNameForCopy('orders', 'qualified', 'postgres')).toBe('"orders"');
    });
});

describe('formatColumnNamesAsSqlList', () => {
    it('formats columns in result-column order for PostgreSQL and SQLite', () => {
        expect(formatColumnNamesAsSqlList(['id', 'email', 'created_at'], 'postgres')).toBe(
            '"id", "email", "created_at"',
        );
        expect(formatColumnNamesAsSqlList(['id', 'email', 'created_at'], 'sqlite')).toBe(
            '"id", "email", "created_at"',
        );
    });

    it('formats columns with backticks for MySQL and MariaDB', () => {
        expect(formatColumnNamesAsSqlList(['id', 'email', 'created_at'], 'mysql')).toBe(
            '`id`, `email`, `created_at`',
        );
        expect(formatColumnNamesAsSqlList(['id', 'email'], 'mariadb')).toBe('`id`, `email`');
    });

    it('quotes reserved words, spaces, and embedded quote characters', () => {
        const columns = ['select', 'full name', 'a"b', 'c`d', 'order'];
        expect(formatColumnNamesAsSqlList(columns, 'postgres')).toBe(
            '"select", "full name", "a""b", "c`d", "order"',
        );
        expect(formatColumnNamesAsSqlList(columns, 'mysql')).toBe(
            '`select`, `full name`, `a"b`, `c``d`, `order`',
        );
    });

    it('honors an unusual plugin identifier quote and escapes embedded plugin quotes', () => {
        const customCapabilities: DriverCapabilities = {
            ...baseCapabilities,
            identifier_quote: '~',
        };
        expect(formatColumnNamesAsSqlList(['select', 'user name', 'a~b'], customCapabilities)).toBe(
            '~select~, ~user name~, ~a~~b~',
        );

        const customManifest: PluginManifest = {
            id: 'custom-sql',
            name: 'Custom SQL',
            version: '1.0.0',
            description: '',
            default_port: null,
            paradigms: ['sql'],
            capabilities: {
                ...baseCapabilities,
                identifier_quote: "'",
            },
        };
        expect(formatColumnNamesAsSqlList(['id', "display'name", 'from'], customManifest)).toBe(
            "'id', 'display''name', 'from'",
        );
    });

    it('returns an empty string when there are no columns', () => {
        expect(formatColumnNamesAsSqlList([], 'postgres')).toBe('');
    });
});
