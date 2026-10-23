import type {DatabaseBackupPlan, DriverDumpCapability} from '@/types/databaseBackup';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';

export const COMMON_IANA_TIMEZONES = [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Kyiv',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
];

/**
 * Decides whether scheduled backups can run for a driver, from its
 * capabilities only (`.rules/plugins.md` #2). The backup reuses the dump
 * pipeline, which writes SQL in the driver's declared `sql_dialect`, so a
 * driver is dump-capable when it explicitly declares one and talks to a real
 * database (not an API or a folder of files). Plugin drivers follow the same
 * rule as the builtin ones.
 *
 * `reasonKey` is an i18n key explaining why the driver is not capable.
 */
export function isDriverDumpCapable(
    driver: DriverCapabilities | PluginManifest | null | undefined,
): DriverDumpCapability {
    if (!driver) {
        return {
            capable: false,
            reasonKey: 'settings.backup.dbBackupReasonUnknownDriver',
        };
    }

    const caps = 'capabilities' in driver ? driver.capabilities : driver;

    if (caps.no_connection_required) {
        return {capable: false, reasonKey: 'settings.backup.dbBackupReasonApi'};
    }

    if (caps.folder_based) {
        return {
            capable: false,
            reasonKey: 'settings.backup.dbBackupReasonFolder',
        };
    }

    if (!caps.sql_dialect) {
        return {
            capable: false,
            reasonKey: 'settings.backup.dbBackupReasonNoDialect',
        };
    }

    return {capable: true};
}

/**
 * Validates a database backup plan. `driver` is the selected connection's
 * driver manifest, `null` when that driver is not registered, or omitted to
 * skip the driver check (no connection selected yet).
 */
export function validateDatabaseBackupPlan(
    plan: DatabaseBackupPlan,
    driver?: DriverCapabilities | PluginManifest | null,
): {isValid: boolean; errorKey?: string} {
    if (!plan.enabled) {
        return {isValid: true};
    }

    if (!plan.connectionId) {
        return {isValid: false, errorKey: 'settings.backup.databaseBackupErrorNoConnection'};
    }

    if (!plan.destinationDirectory) {
        return {isValid: false, errorKey: 'settings.backup.databaseBackupErrorNoDirectory'};
    }

    // Neither structure nor data would write an empty dump.
    if (!plan.includeStructure && !plan.includeData) {
        return {isValid: false, errorKey: 'settings.backup.databaseBackupErrorNoContent'};
    }

    if (plan.retention < 1) {
        return {isValid: false, errorKey: 'settings.backup.databaseBackupErrorInvalidRetention'};
    }

    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(plan.time)) {
        return {isValid: false, errorKey: 'settings.backup.databaseBackupErrorInvalidTime'};
    }

    if (driver !== undefined) {
        const capability = isDriverDumpCapable(driver);
        if (!capability.capable) {
            return {
                isValid: false,
                errorKey: 'settings.backup.databaseBackupErrorUnsupportedDriver',
            };
        }
    }

    return {isValid: true};
}
