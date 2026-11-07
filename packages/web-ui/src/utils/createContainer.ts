import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {isMultiDatabaseCapable, isSchemaBasedMultiDbCapable} from './database';
import {isReadonly} from './driverCapabilities';
import {quoteIdentifier} from './identifiers';
import {isDialect, type Dialect} from './sqlSplitter';

export type CreateContainerKind = 'database' | 'schema';

type QuotingDriver = string | PluginManifest | DriverCapabilities | null | undefined;

const CREATE_DATABASE_DIALECTS = new Set<Dialect>(['postgres', 'mysql', 'mssql']);
const CREATE_SCHEMA_DIALECTS = new Set<Dialect>(['postgres', 'mssql']);

function resolvedDialect(capabilities?: DriverCapabilities | null): Dialect | undefined {
    const extendsDialect = capabilities?.sql_syntax?.extends;
    if (isDialect(extendsDialect)) return extendsDialect;
    return isDialect(capabilities?.sql_dialect) ? capabilities.sql_dialect : undefined;
}

/**
 * Server-based drivers that speak a dialect with `CREATE DATABASE`. Hidden for
 * file/folder drivers, read-only connections, and dialects (Oracle, SQLite,
 * generic) where that statement is not a thin wrapper.
 */
export function supportsCreateDatabase(capabilities?: DriverCapabilities | null): boolean {
    if (!capabilities || isReadonly(capabilities)) return false;
    if (!isMultiDatabaseCapable(capabilities) && !isSchemaBasedMultiDbCapable(capabilities)) {
        return false;
    }
    const dialect = resolvedDialect(capabilities);
    return !dialect || CREATE_DATABASE_DIALECTS.has(dialect);
}

/**
 * Schema-capable, writable, non-file drivers whose dialect has `CREATE SCHEMA`
 * as its own container (PostgreSQL, SQL Server). MySQL's `CREATE SCHEMA` is an
 * alias for `CREATE DATABASE`, so it is not offered here.
 */
export function supportsCreateSchema(capabilities?: DriverCapabilities | null): boolean {
    if (!capabilities || isReadonly(capabilities)) return false;
    if (capabilities.schemas !== true) return false;
    if (capabilities.file_based === true || capabilities.folder_based === true) return false;
    if (capabilities.no_connection_required === true) return false;
    const dialect = resolvedDialect(capabilities);
    return !dialect || CREATE_SCHEMA_DIALECTS.has(dialect);
}

export function buildCreateDatabaseSql(name: string, driver: QuotingDriver): string {
    return `CREATE DATABASE ${quoteIdentifier(name, driver)}`;
}

export function buildCreateSchemaSql(name: string, driver: QuotingDriver): string {
    return `CREATE SCHEMA ${quoteIdentifier(name, driver)}`;
}

export function appendCreatedName(existing: string[], name: string): string[] {
    return existing.includes(name) ? existing : [...existing, name];
}
