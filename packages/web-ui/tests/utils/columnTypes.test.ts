import {describe, it, expect} from 'vitest';
import {
    parseColumnType,
    parseExistingColumnType,
    existingColumnForm,
    buildColumnDefinition,
    getRequiredExtensions,
    isEnumType,
    parseEnumValues,
    isSetType,
    parseSetValues,
    parseSetMembers,
    serializeSetMembers,
} from '@/utils/columnTypes';
import type {DataTypeInfo} from '@/types/dataTypes';

const makeType = (name: string, overrides: Partial<DataTypeInfo> = {}): DataTypeInfo => ({
    name,
    category: 'other',
    requires_length: false,
    requires_precision: false,
    supports_auto_increment: false,
    ...overrides,
});

const pgTypes: DataTypeInfo[] = [
    makeType('VARCHAR', {category: 'string', requires_length: true, default_length: '255'}),
    makeType('INTEGER', {category: 'numeric', supports_auto_increment: true}),
    makeType('BIGINT', {category: 'numeric', supports_auto_increment: true}),
    makeType('TEXT', {category: 'string'}),
    makeType('BOOLEAN', {category: 'boolean'}),
    makeType('JSONB', {category: 'json'}),
    makeType('GEOMETRY', {category: 'spatial', requires_extension: 'postgis'}),
    makeType('GEOMETRY(Point, 4326)', {category: 'spatial', requires_extension: 'postgis'}),
    makeType('GEOGRAPHY(Point, 4326)', {category: 'spatial', requires_extension: 'postgis'}),
    makeType('INTEGER[]', {category: 'array'}),
    makeType('TEXT[]', {category: 'array'}),
    makeType('HSTORE', {category: 'extension', requires_extension: 'hstore'}),
    makeType('DOUBLE PRECISION', {category: 'numeric'}),
];

const mysqlTypes: DataTypeInfo[] = [
    makeType('VARCHAR', {category: 'string', requires_length: true, default_length: '255'}),
    makeType('INT', {category: 'numeric', supports_auto_increment: true}),
    makeType('TINYINT', {category: 'numeric', supports_auto_increment: true}),
    makeType('DECIMAL', {category: 'numeric', requires_precision: true}),
    makeType('TEXT', {category: 'string'}),
];

describe('columnTypes utils', () => {
    describe('parseColumnType', () => {
        it('should parse simple type without length', () => {
            const result = parseColumnType('INTEGER', pgTypes);
            expect(result).toEqual({type: 'INTEGER', length: ''});
        });

        it('should parse type with length', () => {
            const result = parseColumnType('VARCHAR(255)', pgTypes);
            expect(result).toEqual({type: 'VARCHAR', length: '255'});
        });

        it('should parse type with precision', () => {
            const result = parseColumnType('NUMERIC(10,2)', pgTypes);
            expect(result).toEqual({type: 'NUMERIC', length: '10,2'});
        });

        it('should keep parameterized type name intact when it matches a known type', () => {
            const result = parseColumnType('GEOMETRY(Point, 4326)', pgTypes);
            expect(result).toEqual({type: 'GEOMETRY(Point, 4326)', length: ''});
        });

        it('should keep GEOGRAPHY parameterized type intact', () => {
            const result = parseColumnType('GEOGRAPHY(Point, 4326)', pgTypes);
            expect(result).toEqual({type: 'GEOGRAPHY(Point, 4326)', length: ''});
        });

        it('should handle case-insensitive matching for known types', () => {
            const result = parseColumnType('geometry(point, 4326)', pgTypes);
            expect(result).toEqual({type: 'GEOMETRY(Point, 4326)', length: ''});
        });

        it('should handle array types', () => {
            const result = parseColumnType('INTEGER[]', pgTypes);
            expect(result).toEqual({type: 'INTEGER[]', length: ''});
        });

        it('should handle TEXT[] array type', () => {
            const result = parseColumnType('TEXT[]', pgTypes);
            expect(result).toEqual({type: 'TEXT[]', length: ''});
        });

        it('should handle types with spaces', () => {
            const result = parseColumnType('DOUBLE PRECISION', pgTypes);
            expect(result).toEqual({type: 'DOUBLE PRECISION', length: ''});
        });

        it('should handle lowercase input and return uppercase', () => {
            const result = parseColumnType('varchar(100)', pgTypes);
            expect(result).toEqual({type: 'VARCHAR', length: '100'});
        });

        it('should handle plain GEOMETRY (not parameterized)', () => {
            const result = parseColumnType('GEOMETRY', pgTypes);
            expect(result).toEqual({type: 'GEOMETRY', length: ''});
        });

        it('should handle unknown types gracefully', () => {
            const result = parseColumnType('CUSTOM_TYPE', pgTypes);
            expect(result).toEqual({type: 'CUSTOM_TYPE', length: ''});
        });

        it('should handle empty available types (fallback to regex)', () => {
            const result = parseColumnType('VARCHAR(50)', []);
            expect(result).toEqual({type: 'VARCHAR', length: '50'});
        });

        it('should trim whitespace', () => {
            const result = parseColumnType('  INTEGER  ', pgTypes);
            expect(result).toEqual({type: 'INTEGER', length: ''});
        });

        it('should handle BOOLEAN type', () => {
            const result = parseColumnType('boolean', pgTypes);
            expect(result).toEqual({type: 'BOOLEAN', length: ''});
        });
    });

    describe('parseExistingColumnType', () => {
        it('keeps the length MySQL reports in full_type', () => {
            const column = {data_type: 'varchar', full_type: 'varchar(255)'};
            expect(parseExistingColumnType(column, mysqlTypes)).toEqual({
                type: 'VARCHAR',
                length: '255',
            });
        });

        it('keeps precision and scale from full_type', () => {
            const column = {data_type: 'decimal', full_type: 'decimal(10,2)'};
            expect(parseExistingColumnType(column, mysqlTypes)).toEqual({
                type: 'DECIMAL',
                length: '10,2',
            });
        });

        it('keeps a display width such as tinyint(1)', () => {
            const column = {data_type: 'tinyint', full_type: 'tinyint(1)'};
            expect(parseExistingColumnType(column, mysqlTypes)).toEqual({
                type: 'TINYINT',
                length: '1',
            });
        });

        it('keeps modifiers after the base type, like unsigned', () => {
            const column = {data_type: 'int', full_type: 'int unsigned'};
            expect(parseExistingColumnType(column, mysqlTypes)).toEqual({
                type: 'INT UNSIGNED',
                length: '',
            });
            const decimal = {data_type: 'decimal', full_type: 'decimal(10,2) unsigned'};
            expect(parseExistingColumnType(decimal, mysqlTypes)).toEqual({
                type: 'DECIMAL(10,2) UNSIGNED',
                length: '',
            });
        });

        it('keeps the PostgreSQL length from full_type', () => {
            const column = {data_type: 'character varying', full_type: 'character varying(255)'};
            expect(parseExistingColumnType(column, pgTypes)).toEqual({
                type: 'CHARACTER VARYING',
                length: '255',
            });
        });

        it('uses the separately reported length when there is no full_type', () => {
            const column = {data_type: 'varchar', character_maximum_length: 64};
            expect(parseExistingColumnType(column, mysqlTypes)).toEqual({
                type: 'VARCHAR',
                length: '64',
            });
            const numeric = {data_type: 'numeric', numeric_precision: 12, numeric_scale: 3};
            expect(parseExistingColumnType(numeric, pgTypes)).toEqual({
                type: 'NUMERIC',
                length: '12,3',
            });
        });

        it('parses data_type as before when it already carries the full type', () => {
            expect(parseExistingColumnType({data_type: 'VARCHAR(50)'}, pgTypes)).toEqual({
                type: 'VARCHAR',
                length: '50',
            });
            expect(parseExistingColumnType({data_type: 'INTEGER'}, pgTypes)).toEqual({
                type: 'INTEGER',
                length: '',
            });
            expect(
                parseExistingColumnType({data_type: "enum('a','b')", full_type: null}, mysqlTypes),
            ).toEqual({type: 'ENUM', length: "'a','b'"});
        });
    });

    describe('existingColumnForm', () => {
        const base = {
            name: 'status',
            data_type: 'varchar',
            full_type: 'varchar(20)',
            is_nullable: false,
            is_pk: false,
            is_auto_increment: false,
        };

        it('starts from the default as SQL and keeps ON UPDATE', () => {
            expect(
                existingColumnForm(
                    {...base, default_sql: "'new'", on_update: 'CURRENT_TIMESTAMP'},
                    mysqlTypes,
                    false,
                ),
            ).toEqual({
                name: 'status',
                type: 'VARCHAR',
                length: '20',
                isNullable: false,
                defaultValue: "'new'",
                isPk: false,
                isAutoInc: false,
                comment: undefined,
                onUpdate: 'CURRENT_TIMESTAMP',
            });
        });

        it('leaves the default empty without default_sql or for auto-increment', () => {
            expect(existingColumnForm(base, mysqlTypes, false).defaultValue).toBe('');
            expect(
                existingColumnForm(
                    {...base, is_auto_increment: true, default_sql: "'1'"},
                    mysqlTypes,
                    false,
                ).defaultValue,
            ).toBe('');
        });

        it('carries the comment only when the driver supports comments', () => {
            expect(existingColumnForm({...base, comment: 'Note'}, mysqlTypes, true).comment).toBe(
                'Note',
            );
            expect(
                existingColumnForm({...base, comment: 'Note'}, mysqlTypes, false).comment,
            ).toBeUndefined();
        });
    });

    describe('buildColumnDefinition: default and ON UPDATE', () => {
        const form = {
            name: 'updated',
            type: 'TIMESTAMP',
            isNullable: false,
            defaultValue: 'CURRENT_TIMESTAMP',
            isPk: false,
            isAutoInc: false,
            onUpdate: 'CURRENT_TIMESTAMP',
        };

        it('keeps ON UPDATE for TIMESTAMP and DATETIME', () => {
            expect(buildColumnDefinition(form).on_update).toBe('CURRENT_TIMESTAMP');
            expect(buildColumnDefinition({...form, type: 'datetime', length: '3'}).on_update).toBe(
                'CURRENT_TIMESTAMP',
            );
        });

        it('drops ON UPDATE when the type is changed to something else', () => {
            expect(
                buildColumnDefinition({...form, type: 'VARCHAR', length: '20'}),
            ).not.toHaveProperty('on_update');
        });

        it('sends no default for an auto-increment column', () => {
            expect(
                buildColumnDefinition({...form, type: 'INT', isAutoInc: true, defaultValue: "'1'"})
                    .default_value,
            ).toBeNull();
        });
    });

    describe('buildColumnDefinition', () => {
        it('should build definition with type only', () => {
            const result = buildColumnDefinition({
                name: 'status',
                type: 'BOOLEAN',
                isNullable: false,
                isPk: false,
                isAutoInc: false,
            });
            expect(result).toEqual({
                name: 'status',
                data_type: 'BOOLEAN',
                is_nullable: false,
                is_pk: false,
                is_auto_increment: false,
                default_value: null,
            });
        });

        it('should build definition with type and length', () => {
            const result = buildColumnDefinition({
                name: 'email',
                type: 'VARCHAR',
                length: '255',
                isNullable: true,
                isPk: false,
                isAutoInc: false,
                defaultValue: '',
            });
            expect(result).toEqual({
                name: 'email',
                data_type: 'VARCHAR(255)',
                is_nullable: true,
                is_pk: false,
                is_auto_increment: false,
                default_value: null,
            });
        });

        it('should build definition for auto-increment primary key', () => {
            const result = buildColumnDefinition({
                name: 'id',
                type: 'INTEGER',
                isNullable: false,
                isPk: true,
                isAutoInc: true,
            });
            expect(result).toEqual({
                name: 'id',
                data_type: 'INTEGER',
                is_nullable: false,
                is_pk: true,
                is_auto_increment: true,
                default_value: null,
            });
        });

        it('should build definition with default value', () => {
            const result = buildColumnDefinition({
                name: 'created_at',
                type: 'TIMESTAMPTZ',
                isNullable: false,
                isPk: false,
                isAutoInc: false,
                defaultValue: 'NOW()',
            });
            expect(result).toEqual({
                name: 'created_at',
                data_type: 'TIMESTAMPTZ',
                is_nullable: false,
                is_pk: false,
                is_auto_increment: false,
                default_value: 'NOW()',
            });
        });

        it('should preserve parameterized type name without adding extra parentheses', () => {
            const result = buildColumnDefinition({
                name: 'geom',
                type: 'GEOMETRY(Point, 4326)',
                isNullable: true,
                isPk: false,
                isAutoInc: false,
            });
            expect(result.data_type).toBe('GEOMETRY(Point, 4326)');
        });

        it('should preserve array type name', () => {
            const result = buildColumnDefinition({
                name: 'tags',
                type: 'TEXT[]',
                isNullable: true,
                isPk: false,
                isAutoInc: false,
            });
            expect(result.data_type).toBe('TEXT[]');
        });

        it('should build definition with precision', () => {
            const result = buildColumnDefinition({
                name: 'price',
                type: 'NUMERIC',
                length: '10,2',
                isNullable: false,
                isPk: false,
                isAutoInc: false,
            });
            expect(result.data_type).toBe('NUMERIC(10,2)');
        });

        it('should preserve comment whitespace when one is given', () => {
            const result = buildColumnDefinition({
                name: 'email',
                type: 'STRING',
                isNullable: true,
                isPk: false,
                isAutoInc: false,
                comment: '  Primary contact  ',
            });
            expect(result).toHaveProperty('comment', '  Primary contact  ');
        });

        it('should omit the comment key when it is blank or missing', () => {
            const blank = buildColumnDefinition({
                name: 'email',
                type: 'STRING',
                isNullable: true,
                isPk: false,
                isAutoInc: false,
                comment: '   ',
            });
            const missing = buildColumnDefinition({
                name: 'email',
                type: 'STRING',
                isNullable: true,
                isPk: false,
                isAutoInc: false,
            });
            expect('comment' in blank).toBe(false);
            expect('comment' in missing).toBe(false);
        });
    });

    describe('getRequiredExtensions', () => {
        it('should return empty array when no extensions needed', () => {
            const result = getRequiredExtensions(['INTEGER', 'TEXT', 'BOOLEAN'], pgTypes);
            expect(result).toEqual([]);
        });

        it('should return postgis for geometry types', () => {
            const result = getRequiredExtensions(['GEOMETRY(Point, 4326)'], pgTypes);
            expect(result).toEqual(['postgis']);
        });

        it('should deduplicate extensions', () => {
            const result = getRequiredExtensions(
                ['GEOMETRY', 'GEOMETRY(Point, 4326)', 'GEOGRAPHY(Point, 4326)'],
                pgTypes,
            );
            expect(result).toEqual(['postgis']);
        });

        it('should return multiple distinct extensions', () => {
            const result = getRequiredExtensions(['GEOMETRY', 'HSTORE'], pgTypes);
            expect(result).toEqual(expect.arrayContaining(['postgis', 'hstore']));
            expect(result).toHaveLength(2);
        });

        it('should handle unknown types gracefully', () => {
            const result = getRequiredExtensions(['UNKNOWN_TYPE'], pgTypes);
            expect(result).toEqual([]);
        });

        it('should handle empty column list', () => {
            const result = getRequiredExtensions([], pgTypes);
            expect(result).toEqual([]);
        });

        it('should handle mix of extension and non-extension types', () => {
            const result = getRequiredExtensions(
                ['INTEGER', 'GEOMETRY(Point, 4326)', 'TEXT', 'HSTORE'],
                pgTypes,
            );
            expect(result).toEqual(expect.arrayContaining(['postgis', 'hstore']));
            expect(result).toHaveLength(2);
        });
    });

    describe('isEnumType', () => {
        it('should detect a plain enum definition', () => {
            expect(isEnumType("enum('pending','approved','rejected')")).toBe(true);
        });

        it('should be case-insensitive and tolerate whitespace before the paren', () => {
            expect(isEnumType("ENUM ('a','b')")).toBe(true);
        });

        it('should not match set types', () => {
            expect(isEnumType("set('news','tech')")).toBe(false);
        });

        it('should not match scalar types or a bare "enum" word', () => {
            expect(isEnumType('varchar(255)')).toBe(false);
            expect(isEnumType('enum')).toBe(false);
            expect(isEnumType('')).toBe(false);
        });
    });

    describe('parseEnumValues', () => {
        it('should extract the allowed values unquoted', () => {
            expect(parseEnumValues("enum('pending','approved','rejected')")).toEqual([
                'pending',
                'approved',
                'rejected',
            ]);
        });

        it('should unescape doubled single quotes', () => {
            expect(parseEnumValues("enum('plain','it''s complicated','other')")).toEqual([
                'plain',
                "it's complicated",
                'other',
            ]);
        });

        it('should handle a single value', () => {
            expect(parseEnumValues("enum('only')")).toEqual(['only']);
        });

        it('should return an empty array for non-enum input', () => {
            expect(parseEnumValues('varchar(255)')).toEqual([]);
            expect(parseEnumValues('enum')).toEqual([]);
            expect(parseEnumValues('')).toEqual([]);
        });
    });

    describe('isSetType', () => {
        it('should detect a plain set definition', () => {
            expect(isSetType("set('news','sport','tech')")).toBe(true);
        });

        it('should be case-insensitive and tolerate whitespace before the paren', () => {
            expect(isSetType("SET ('a','b')")).toBe(true);
        });

        it('should not match enum types', () => {
            expect(isSetType("enum('pending','approved')")).toBe(false);
        });

        it('should not match scalar types or a bare "set" word', () => {
            expect(isSetType('varchar(255)')).toBe(false);
            expect(isSetType('set')).toBe(false);
            expect(isSetType('')).toBe(false);
        });
    });

    describe('parseSetValues', () => {
        it('should extract the allowed values unquoted', () => {
            expect(parseSetValues("set('news','sport','tech')")).toEqual(['news', 'sport', 'tech']);
        });

        it('should unescape doubled single quotes', () => {
            expect(parseSetValues("set('a','it''s','b')")).toEqual(['a', "it's", 'b']);
        });

        it('should return an empty array for non-set input', () => {
            expect(parseSetValues("enum('a','b')")).toEqual([]);
            expect(parseSetValues('set')).toEqual([]);
            expect(parseSetValues('')).toEqual([]);
        });
    });

    describe('parseSetMembers', () => {
        it('should split a comma-joined set value into members', () => {
            expect(parseSetMembers('news,tech')).toEqual(['news', 'tech']);
        });

        it('should return an empty array for the empty set', () => {
            expect(parseSetMembers('')).toEqual([]);
        });

        it('should handle a single member', () => {
            expect(parseSetMembers('news')).toEqual(['news']);
        });
    });

    describe('serializeSetMembers', () => {
        const allowed = ['news', 'sport', 'tech', 'music'];

        it('should serialize members in the declared order regardless of input order', () => {
            expect(serializeSetMembers(['tech', 'news'], allowed)).toBe('news,tech');
        });

        it('should ignore members not present in the allowed list', () => {
            expect(serializeSetMembers(['news', 'bogus'], allowed)).toBe('news');
        });

        it('should return an empty string for no members', () => {
            expect(serializeSetMembers([], allowed)).toBe('');
        });

        it('should accept a Set as input', () => {
            expect(serializeSetMembers(new Set(['music', 'sport']), allowed)).toBe('sport,music');
        });
    });
});
