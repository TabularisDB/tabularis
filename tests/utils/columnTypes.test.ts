import { describe, it, expect } from 'vitest';
import {
  parseColumnType,
  buildColumnDefinition,
  getRequiredExtensions,
} from '../../src/utils/columnTypes';
import type { DataTypeInfo } from '../../src/types/dataTypes';

const makeType = (
  name: string,
  overrides: Partial<DataTypeInfo> = {},
): DataTypeInfo => ({
  name,
  category: 'other',
  requires_length: false,
  requires_precision: false,
  supports_auto_increment: false,
  ...overrides,
});

const pgTypes: DataTypeInfo[] = [
  makeType('VARCHAR', { category: 'string', requires_length: true, default_length: '255' }),
  makeType('INTEGER', { category: 'numeric', supports_auto_increment: true }),
  makeType('BIGINT', { category: 'numeric', supports_auto_increment: true }),
  makeType('TEXT', { category: 'string' }),
  makeType('BOOLEAN', { category: 'boolean' }),
  makeType('JSONB', { category: 'json' }),
  makeType('GEOMETRY', { category: 'spatial', requires_extension: 'postgis' }),
  makeType('GEOMETRY(Point, 4326)', { category: 'spatial', requires_extension: 'postgis' }),
  makeType('GEOGRAPHY(Point, 4326)', { category: 'spatial', requires_extension: 'postgis' }),
  makeType('INTEGER[]', { category: 'array' }),
  makeType('TEXT[]', { category: 'array' }),
  makeType('HSTORE', { category: 'extension', requires_extension: 'hstore' }),
  makeType('DOUBLE PRECISION', { category: 'numeric' }),
];

describe('columnTypes utils', () => {
  describe('parseColumnType', () => {
    it('should parse simple type without length', () => {
      const result = parseColumnType('INTEGER', pgTypes);
      expect(result).toEqual({ type: 'INTEGER', length: '' });
    });

    it('should parse type with length', () => {
      const result = parseColumnType('VARCHAR(255)', pgTypes);
      expect(result).toEqual({ type: 'VARCHAR', length: '255' });
    });

    it('should parse type with precision', () => {
      const result = parseColumnType('NUMERIC(10,2)', pgTypes);
      expect(result).toEqual({ type: 'NUMERIC', length: '10,2' });
    });

    it('should keep parameterized type name intact when it matches a known type', () => {
      const result = parseColumnType('GEOMETRY(Point, 4326)', pgTypes);
      expect(result).toEqual({ type: 'GEOMETRY(Point, 4326)', length: '' });
    });

    it('should keep GEOGRAPHY parameterized type intact', () => {
      const result = parseColumnType('GEOGRAPHY(Point, 4326)', pgTypes);
      expect(result).toEqual({ type: 'GEOGRAPHY(Point, 4326)', length: '' });
    });

    it('should handle case-insensitive matching for known types', () => {
      const result = parseColumnType('geometry(point, 4326)', pgTypes);
      expect(result).toEqual({ type: 'GEOMETRY(Point, 4326)', length: '' });
    });

    it('should handle array types', () => {
      const result = parseColumnType('INTEGER[]', pgTypes);
      expect(result).toEqual({ type: 'INTEGER[]', length: '' });
    });

    it('should handle TEXT[] array type', () => {
      const result = parseColumnType('TEXT[]', pgTypes);
      expect(result).toEqual({ type: 'TEXT[]', length: '' });
    });

    it('should handle types with spaces', () => {
      const result = parseColumnType('DOUBLE PRECISION', pgTypes);
      expect(result).toEqual({ type: 'DOUBLE PRECISION', length: '' });
    });

    it('should handle lowercase input and return uppercase', () => {
      const result = parseColumnType('varchar(100)', pgTypes);
      expect(result).toEqual({ type: 'VARCHAR', length: '100' });
    });

    it('should handle plain GEOMETRY (not parameterized)', () => {
      const result = parseColumnType('GEOMETRY', pgTypes);
      expect(result).toEqual({ type: 'GEOMETRY', length: '' });
    });

    it('should handle unknown types gracefully', () => {
      const result = parseColumnType('CUSTOM_TYPE', pgTypes);
      expect(result).toEqual({ type: 'CUSTOM_TYPE', length: '' });
    });

    it('should handle empty available types (fallback to regex)', () => {
      const result = parseColumnType('VARCHAR(50)', []);
      expect(result).toEqual({ type: 'VARCHAR', length: '50' });
    });

    it('should trim whitespace', () => {
      const result = parseColumnType('  INTEGER  ', pgTypes);
      expect(result).toEqual({ type: 'INTEGER', length: '' });
    });

    it('should handle BOOLEAN type', () => {
      const result = parseColumnType('boolean', pgTypes);
      expect(result).toEqual({ type: 'BOOLEAN', length: '' });
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
      const result = getRequiredExtensions(
        ['GEOMETRY', 'HSTORE'],
        pgTypes,
      );
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
});
