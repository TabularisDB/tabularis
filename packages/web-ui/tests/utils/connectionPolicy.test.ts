import {describe, expect, it} from 'vitest';
import {effectiveConnectionCapabilities, supportsReadOnlyQueries} from '@/utils/connectionPolicy';
import type {DriverCapabilities} from '@/types/plugins';

const capabilities: DriverCapabilities = {
    schemas: true,
    views: true,
    routines: true,
    file_based: false,
    folder_based: false,
    identifier_quote: '`',
    alter_primary_key: true,
    sql_dialect: 'mysql',
    manage_tables: true,
    table_import: true,
    explain: true,
    user_management: true,
    routine_management: true,
    read_only_queries: true,
};

describe('connectionPolicy', () => {
    it('requires explicit opt-in for writable plugin drivers', () => {
        expect(supportsReadOnlyQueries(undefined)).toBe(false);
        expect(supportsReadOnlyQueries({...capabilities, read_only_queries: undefined})).toBe(
            false,
        );
        expect(supportsReadOnlyQueries(capabilities)).toBe(true);
        expect(
            supportsReadOnlyQueries({...capabilities, read_only_queries: false, readonly: true}),
        ).toBe(true);
    });

    it('disables mutations without changing the plugin manifest or its SQL dialect', () => {
        const effective = effectiveConnectionCapabilities(capabilities, true);
        expect(effective).toMatchObject({
            readonly: true,
            manage_tables: false,
            alter_primary_key: false,
            table_import: false,
            explain: false,
            user_management: false,
            routine_management: false,
            identifier_quote: '`',
            sql_dialect: 'mysql',
            views: true,
        });
        expect(capabilities.manage_tables).toBe(true);
        expect(capabilities.readonly).toBeUndefined();
    });

    it('preserves normal and intrinsically read-only driver capabilities', () => {
        expect(effectiveConnectionCapabilities(capabilities, undefined)).toBe(capabilities);
        expect(effectiveConnectionCapabilities(null, true)).toBeNull();
        const immutable = {...capabilities, readonly: true};
        expect(effectiveConnectionCapabilities(immutable, false)?.readonly).toBe(true);
    });
});
