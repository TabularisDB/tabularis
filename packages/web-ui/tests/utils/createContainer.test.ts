import {describe, expect, it} from 'vitest';
import {
    appendCreatedName,
    buildCreateDatabaseSql,
    buildCreateSchemaSql,
    supportsCreateDatabase,
    supportsCreateSchema,
} from '@/utils/createContainer';
import type {DriverCapabilities} from '@/types/plugins';

const mysqlCaps = (overrides: Partial<DriverCapabilities> = {}): DriverCapabilities => ({
    schemas: false,
    views: true,
    routines: true,
    file_based: false,
    folder_based: false,
    identifier_quote: '`',
    alter_primary_key: true,
    sql_dialect: 'mysql',
    ...overrides,
});

const postgresCaps = (overrides: Partial<DriverCapabilities> = {}): DriverCapabilities => ({
    schemas: true,
    views: true,
    routines: true,
    file_based: false,
    folder_based: false,
    identifier_quote: '"',
    alter_primary_key: true,
    sql_dialect: 'postgres',
    ...overrides,
});

describe('supportsCreateDatabase', () => {
    it('is on for MySQL-like and PostgreSQL-like server drivers', () => {
        expect(supportsCreateDatabase(mysqlCaps())).toBe(true);
        expect(supportsCreateDatabase(postgresCaps())).toBe(true);
        expect(supportsCreateDatabase(mysqlCaps({sql_dialect: 'mssql'}))).toBe(true);
    });

    it('is off for file, folder, single-database, read-only, and Oracle drivers', () => {
        expect(supportsCreateDatabase(mysqlCaps({file_based: true, sql_dialect: 'sqlite'}))).toBe(
            false,
        );
        expect(supportsCreateDatabase(mysqlCaps({folder_based: true}))).toBe(false);
        expect(supportsCreateDatabase(mysqlCaps({single_database: true}))).toBe(false);
        expect(supportsCreateDatabase(mysqlCaps({readonly: true}))).toBe(false);
        expect(supportsCreateDatabase(postgresCaps({sql_dialect: 'oracle'}))).toBe(false);
        expect(supportsCreateDatabase(null)).toBe(false);
    });

    it('still offers the action for a postgres-like plugin that omitted sql_dialect', () => {
        expect(supportsCreateDatabase({...postgresCaps(), sql_dialect: undefined})).toBe(true);
    });
});

describe('supportsCreateSchema', () => {
    it('is on for PostgreSQL and SQL Server, off for MySQL', () => {
        expect(supportsCreateSchema(postgresCaps())).toBe(true);
        expect(supportsCreateSchema(postgresCaps({sql_dialect: 'mssql'}))).toBe(true);
        expect(supportsCreateSchema(mysqlCaps())).toBe(false);
    });

    it('is off for read-only, file-based, and Oracle schema drivers', () => {
        expect(supportsCreateSchema(postgresCaps({readonly: true}))).toBe(false);
        expect(supportsCreateSchema(postgresCaps({file_based: true}))).toBe(false);
        expect(supportsCreateSchema(postgresCaps({sql_dialect: 'oracle'}))).toBe(false);
        expect(supportsCreateSchema(null)).toBe(false);
    });
});

describe('CREATE DATABASE / CREATE SCHEMA SQL', () => {
    it('quotes with the driver identifier_quote, including a plugin quote character', () => {
        expect(buildCreateDatabaseSql('analytics', mysqlCaps())).toBe(
            'CREATE DATABASE `analytics`',
        );
        expect(buildCreateDatabaseSql('analytics', postgresCaps())).toBe(
            'CREATE DATABASE "analytics"',
        );
        expect(buildCreateSchemaSql('store', postgresCaps())).toBe('CREATE SCHEMA "store"');
        expect(buildCreateDatabaseSql('odd name', mysqlCaps({identifier_quote: '~'}))).toBe(
            'CREATE DATABASE ~odd name~',
        );
    });

    it('doubles a quote that appears in the name', () => {
        expect(buildCreateSchemaSql('a"b', postgresCaps())).toBe('CREATE SCHEMA "a""b"');
    });
});

describe('appendCreatedName', () => {
    it('appends a new name and leaves an existing one unchanged', () => {
        expect(appendCreatedName(['app'], 'analytics')).toEqual(['app', 'analytics']);
        expect(appendCreatedName(['app'], 'app')).toEqual(['app']);
    });
});
