import {describe, it, expect} from 'vitest';
import {isDriverDumpCapable, validateDatabaseBackupPlan} from '../../src/utils/databaseBackup';
import type {DatabaseBackupPlan} from '../../src/types/databaseBackup';
import type {DriverCapabilities, PluginManifest} from '../../src/types/plugins';

const baseCapabilities: DriverCapabilities = {
    schemas: false,
    views: false,
    routines: false,
    file_based: false,
    folder_based: false,
    identifier_quote: '"',
    alter_primary_key: false,
};

function manifest(id: string, capabilities: Partial<DriverCapabilities>): PluginManifest {
    return {
        id,
        name: id,
        version: '1.0.0',
        description: '',
        default_port: null,
        capabilities: {...baseCapabilities, ...capabilities},
    };
}

describe('databaseBackup utils', () => {
    describe('isDriverDumpCapable', () => {
        it.each(['postgres', 'mysql', 'sqlite', 'mssql', 'oracle', 'generic'] as const)(
            'accepts a driver declaring the %s dialect',
            (sql_dialect) => {
                expect(isDriverDumpCapable(manifest('any-id', {sql_dialect})).capable).toBe(true);
            },
        );

        it('decides from capabilities, not from the driver id', () => {
            // A plugin speaking PostgreSQL under its own id and backtick quoting.
            const plugin = manifest('acme-pg', {
                sql_dialect: 'postgres',
                identifier_quote: '`',
            });
            expect(isDriverDumpCapable(plugin)).toEqual({capable: true});

            // A driver named like a builtin but without a declared dialect.
            const impostor = manifest('postgres', {});
            expect(isDriverDumpCapable(impostor).capable).toBe(false);
        });

        it('accepts a bare capabilities object', () => {
            expect(isDriverDumpCapable({...baseCapabilities, sql_dialect: 'mysql'}).capable).toBe(
                true,
            );
        });

        it('does not treat manage_tables as dump support', () => {
            const result = isDriverDumpCapable(manifest('kv-store', {manage_tables: true}));
            expect(result).toEqual({
                capable: false,
                reasonKey: 'settings.backup.dbBackupReasonNoDialect',
            });
        });

        it('rejects API drivers even when they declare a dialect', () => {
            const result = isDriverDumpCapable(
                manifest('rest-api', {no_connection_required: true, sql_dialect: 'generic'}),
            );
            expect(result).toEqual({
                capable: false,
                reasonKey: 'settings.backup.dbBackupReasonApi',
            });
        });

        it('rejects folder-based drivers', () => {
            const result = isDriverDumpCapable(
                manifest('csv-folder', {folder_based: true, sql_dialect: 'generic'}),
            );
            expect(result).toEqual({
                capable: false,
                reasonKey: 'settings.backup.dbBackupReasonFolder',
            });
        });

        it('rejects a connection whose driver is not registered', () => {
            expect(isDriverDumpCapable(null)).toEqual({
                capable: false,
                reasonKey: 'settings.backup.dbBackupReasonUnknownDriver',
            });
        });
    });

    describe('validateDatabaseBackupPlan', () => {
        const validPlan: DatabaseBackupPlan = {
            enabled: true,
            connectionId: 'conn_pg',
            database: 'production',
            time: '02:00',
            timezone: 'UTC',
            destinationDirectory: '/backups',
            retention: 7,
            includeStructure: true,
            includeData: true,
        };
        const pgDriver = manifest('postgres', {sql_dialect: 'postgres'});

        it('accepts a valid plan for a dump-capable driver', () => {
            expect(validateDatabaseBackupPlan(validPlan, pgDriver).isValid).toBe(true);
        });

        it('skips the driver check when no driver is given', () => {
            expect(validateDatabaseBackupPlan(validPlan).isValid).toBe(true);
        });

        it('rejects a driver that cannot be dumped', () => {
            const res = validateDatabaseBackupPlan(
                validPlan,
                manifest('rest-api', {no_connection_required: true}),
            );
            expect(res).toEqual({
                isValid: false,
                errorKey: 'settings.backup.databaseBackupErrorUnsupportedDriver',
            });
        });

        it('rejects an unregistered driver', () => {
            expect(validateDatabaseBackupPlan(validPlan, null).isValid).toBe(false);
        });

        it.each([
            [{connectionId: ''}, 'settings.backup.databaseBackupErrorNoConnection'],
            [{destinationDirectory: ''}, 'settings.backup.databaseBackupErrorNoDirectory'],
            [{retention: 0}, 'settings.backup.databaseBackupErrorInvalidRetention'],
            [{time: '25:70'}, 'settings.backup.databaseBackupErrorInvalidTime'],
            [{time: '2:00'}, 'settings.backup.databaseBackupErrorInvalidTime'],
            [
                {includeStructure: false, includeData: false},
                'settings.backup.databaseBackupErrorNoContent',
            ],
        ])('rejects %o', (patch, errorKey) => {
            const res = validateDatabaseBackupPlan({...validPlan, ...patch}, pgDriver);
            expect(res).toEqual({isValid: false, errorKey});
        });

        it.each([{includeStructure: false}, {includeData: false}])(
            'accepts a plan with only one kind of content: %o',
            (patch) => {
                expect(validateDatabaseBackupPlan({...validPlan, ...patch}, pgDriver).isValid).toBe(
                    true,
                );
            },
        );

        it('always validates disabled plans as valid', () => {
            const disabledPlan: DatabaseBackupPlan = {
                ...validPlan,
                enabled: false,
                connectionId: '',
                destinationDirectory: '',
            };
            expect(validateDatabaseBackupPlan(disabledPlan, null).isValid).toBe(true);
        });
    });
});
