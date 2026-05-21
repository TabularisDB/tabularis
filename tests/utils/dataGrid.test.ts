import { describe, it, expect } from 'vitest';
import {
  formatCellValue,
  getColumnSortState,
  calculateSelectionRange,
  toggleSetValue,
  USE_DEFAULT_SENTINEL,
  resolveInsertionCellDisplay,
  resolveExistingCellDisplay,
  getCellStateClass,
  type ColumnDisplayInfo,
  type CellClassParams,
} from '../../src/utils/dataGrid';

describe('dataGrid utils', () => {
  describe('formatCellValue', () => {
    it('should return nullLabel for null values', () => {
      expect(formatCellValue(null)).toBe('NULL');
      expect(formatCellValue(null, 'N/A')).toBe('N/A');
    });

    it('should return nullLabel for undefined values', () => {
      expect(formatCellValue(undefined)).toBe('NULL');
      expect(formatCellValue(undefined, 'Empty')).toBe('Empty');
    });

    it('should format boolean true as "true"', () => {
      expect(formatCellValue(true)).toBe('true');
    });

    it('should format boolean false as "false"', () => {
      expect(formatCellValue(false)).toBe('false');
    });

    it('should stringify objects as JSON', () => {
      expect(formatCellValue({ name: 'John', age: 30 })).toBe('{"name":"John","age":30}');
      expect(formatCellValue([1, 2, 3])).toBe('[1,2,3]');
    });

    it('should convert numbers to strings', () => {
      expect(formatCellValue(42)).toBe('42');
      expect(formatCellValue(3.14)).toBe('3.14');
      expect(formatCellValue(-100)).toBe('-100');
      expect(formatCellValue(0)).toBe('0');
    });

    it('should return strings as-is', () => {
      expect(formatCellValue('hello')).toBe('hello');
      expect(formatCellValue('')).toBe('');
      expect(formatCellValue('  spaced  ')).toBe('  spaced  ');
    });

    it('should handle special number values', () => {
      expect(formatCellValue(Infinity)).toBe('Infinity');
      expect(formatCellValue(-Infinity)).toBe('-Infinity');
      expect(formatCellValue(NaN)).toBe('NaN');
    });

    it('should handle nested objects', () => {
      const nested = { user: { name: 'John', address: { city: 'NYC' } } };
      expect(formatCellValue(nested)).toBe('{"user":{"name":"John","address":{"city":"NYC"}}}');
    });

    it('should JSON-encode scalar strings in jsonb columns', () => {
      expect(formatCellValue('🦊', 'NULL', 'jsonb')).toBe('"🦊"');
      expect(formatCellValue('hello', 'NULL', 'json')).toBe('"hello"');
    });

    it('should JSON-encode scalar numbers in jsonb columns', () => {
      expect(formatCellValue(42, 'NULL', 'jsonb')).toBe('42');
      expect(formatCellValue(3.14, 'NULL', 'json')).toBe('3.14');
    });

    it('should JSON-encode scalar booleans in jsonb columns', () => {
      expect(formatCellValue(true, 'NULL', 'jsonb')).toBe('true');
      expect(formatCellValue(false, 'NULL', 'json')).toBe('false');
    });

    it('should keep null label for null values in jsonb columns', () => {
      expect(formatCellValue(null, 'NULL', 'jsonb')).toBe('NULL');
    });

    it('should handle empty objects and arrays', () => {
      expect(formatCellValue({})).toBe('{}');
      expect(formatCellValue([])).toBe('[]');
    });

    describe('with columnType parameter', () => {
      it('should format geometric WKB hex values as WKT when columnType is POINT', () => {
        // MySQL format with SRID prefix (4 bytes) + standard WKB
        const wkbPoint = '0x000000000101000000000000000000F03F0000000000000040';
        const result = formatCellValue(wkbPoint, 'NULL', 'POINT');
        expect(result).toContain('POINT');
        expect(result).not.toContain('0x');
      });

      it('should format geometric WKT values as-is when columnType is GEOMETRY', () => {
        const wkt = 'POINT(1 2)';
        const result = formatCellValue(wkt, 'NULL', 'GEOMETRY');
        expect(result).toBe(wkt);
      });

      it('should format geometric NULL as NULL', () => {
        const result = formatCellValue(null, 'NULL', 'POINT');
        expect(result).toBe('NULL');
      });

      it('should not affect non-geometric types', () => {
        expect(formatCellValue('hello', 'NULL', 'VARCHAR')).toBe('hello');
        expect(formatCellValue(42, 'NULL', 'INT')).toBe('42');
        expect(formatCellValue(true, 'NULL', 'BOOLEAN')).toBe('true');
      });

      it('should handle case-insensitive geometric types', () => {
        const wkt = 'LINESTRING(0 0, 1 1)';
        expect(formatCellValue(wkt, 'NULL', 'linestring')).toBe(wkt);
        expect(formatCellValue(wkt, 'NULL', 'LINESTRING')).toBe(wkt);
        expect(formatCellValue(wkt, 'NULL', 'LineString')).toBe(wkt);
      });

      it('should handle all geometric types (POLYGON, MULTIPOINT, etc.)', () => {
        const polygon = 'POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))';
        expect(formatCellValue(polygon, 'NULL', 'POLYGON')).toBe(polygon);

        const multipoint = 'MULTIPOINT((1 2), (3 4))';
        expect(formatCellValue(multipoint, 'NULL', 'MULTIPOINT')).toBe(multipoint);
      });

      it('should work without columnType parameter (backward compatibility)', () => {
        expect(formatCellValue('hello')).toBe('hello');
        expect(formatCellValue(null)).toBe('NULL');
        expect(formatCellValue(42)).toBe('42');
      });

      it('should handle undefined columnType gracefully', () => {
        expect(formatCellValue('test', 'NULL', undefined)).toBe('test');
        expect(formatCellValue(null, 'NULL', undefined)).toBe('NULL');
      });
    });
  });

  describe('getColumnSortState', () => {
    it('should return null for empty sort clause', () => {
      expect(getColumnSortState('name', '')).toBeNull();
      expect(getColumnSortState('name', undefined)).toBeNull();
    });

    it('should detect ASC sort', () => {
      expect(getColumnSortState('name', 'name ASC')).toBe('asc');
      expect(getColumnSortState('name', 'name asc')).toBe('asc');
    });

    it('should detect DESC sort', () => {
      expect(getColumnSortState('name', 'name DESC')).toBe('desc');
      expect(getColumnSortState('name', 'name desc')).toBe('desc');
    });

    it('should default to ASC when no direction specified', () => {
      expect(getColumnSortState('name', 'name')).toBe('asc');
    });

    it('should be case-insensitive for column names', () => {
      expect(getColumnSortState('NAME', 'name ASC')).toBe('asc');
      expect(getColumnSortState('Name', 'NAME desc')).toBe('desc');
    });

    it('should handle qualified column names (table.column)', () => {
      expect(getColumnSortState('users.name', 'users.name ASC')).toBe('asc');
      expect(getColumnSortState('name', 'users.name DESC')).toBe('desc');
    });

    it('should handle multiple sort columns', () => {
      expect(getColumnSortState('name', 'name ASC, id DESC')).toBe('asc');
      expect(getColumnSortState('id', 'name ASC, id DESC')).toBe('desc');
      expect(getColumnSortState('age', 'name ASC, id DESC')).toBeNull();
    });

    it('should return null when column not in sort clause', () => {
      expect(getColumnSortState('email', 'name ASC')).toBeNull();
      expect(getColumnSortState('id', 'name, email')).toBeNull();
    });

    it('should handle column names with special regex characters', () => {
      expect(getColumnSortState('col.name', 'col.name ASC')).toBe('asc');
      expect(getColumnSortState('col[name]', 'col[name] DESC')).toBe('desc');
    });

    it('should handle sort clause with whitespace variations', () => {
      expect(getColumnSortState('name', 'name   ASC')).toBe('asc');
      expect(getColumnSortState('name', 'name  desc')).toBe('desc');
    });
  });

  describe('calculateSelectionRange', () => {
    it('should calculate range from lower to higher index', () => {
      expect(calculateSelectionRange(2, 5)).toEqual([2, 3, 4, 5]);
    });

    it('should calculate range from higher to lower index', () => {
      expect(calculateSelectionRange(5, 2)).toEqual([2, 3, 4, 5]);
    });

    it('should return single index when start equals end', () => {
      expect(calculateSelectionRange(3, 3)).toEqual([3]);
    });

    it('should handle zero as start index', () => {
      expect(calculateSelectionRange(0, 3)).toEqual([0, 1, 2, 3]);
      expect(calculateSelectionRange(3, 0)).toEqual([0, 1, 2, 3]);
    });

    it('should handle negative indices', () => {
      expect(calculateSelectionRange(-2, 2)).toEqual([-2, -1, 0, 1, 2]);
      expect(calculateSelectionRange(2, -2)).toEqual([-2, -1, 0, 1, 2]);
    });

    it('should handle large ranges', () => {
      const range = calculateSelectionRange(0, 99);
      expect(range).toHaveLength(100);
      expect(range[0]).toBe(0);
      expect(range[99]).toBe(99);
    });

    it('should handle consecutive indices', () => {
      expect(calculateSelectionRange(5, 6)).toEqual([5, 6]);
      expect(calculateSelectionRange(6, 5)).toEqual([5, 6]);
    });
  });

  describe('toggleSetValue', () => {
    it('should add value to empty set', () => {
      const set = new Set<number>();
      const result = toggleSetValue(set, 1);
      expect(result.has(1)).toBe(true);
      expect(result.size).toBe(1);
    });

    it('should add value to existing set', () => {
      const set = new Set([1, 2, 3]);
      const result = toggleSetValue(set, 4);
      expect(result.has(4)).toBe(true);
      expect(result.size).toBe(4);
    });

    it('should remove value if already present', () => {
      const set = new Set([1, 2, 3]);
      const result = toggleSetValue(set, 2);
      expect(result.has(2)).toBe(false);
      expect(result.size).toBe(2);
    });

    it('should not modify original set', () => {
      const set = new Set([1, 2, 3]);
      const result = toggleSetValue(set, 4);
      expect(set.has(4)).toBe(false);
      expect(set.size).toBe(3);
    });

    it('should handle string values', () => {
      const set = new Set<string>(['a', 'b']);
      const result = toggleSetValue(set, 'c');
      expect(result.has('c')).toBe(true);
      
      const removed = toggleSetValue(result, 'a');
      expect(removed.has('a')).toBe(false);
    });

    it('should handle object references', () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const set = new Set([obj1]);
      
      const added = toggleSetValue(set, obj2);
      expect(added.has(obj2)).toBe(true);
      
      const removed = toggleSetValue(added, obj1);
      expect(removed.has(obj1)).toBe(false);
    });

    it('should handle mixed types (with union types)', () => {
      const set = new Set<string | number>(['a', 1]);
      const result = toggleSetValue(set, 2);
      expect(result.has(2)).toBe(true);
    });

    it('should toggle value back and forth', () => {
      let set = new Set<number>([1, 2]);
      set = toggleSetValue(set, 3);
      expect(set.has(3)).toBe(true);
      
      set = toggleSetValue(set, 3);
      expect(set.has(3)).toBe(false);
      
      set = toggleSetValue(set, 3);
      expect(set.has(3)).toBe(true);
    });

    it('should handle empty set removal', () => {
      const set = new Set<number>();
      const result = toggleSetValue(set, 1);
      const removed = toggleSetValue(result, 1);
      expect(removed.size).toBe(0);
    });
  });

  describe('USE_DEFAULT_SENTINEL', () => {
    it('should be a non-empty string constant', () => {
      expect(typeof USE_DEFAULT_SENTINEL).toBe('string');
      expect(USE_DEFAULT_SENTINEL.length).toBeGreaterThan(0);
    });

    it('should have a recognizable sentinel pattern', () => {
      expect(USE_DEFAULT_SENTINEL).toBe('__USE_DEFAULT__');
    });
  });

  describe('resolveInsertionCellDisplay', () => {
    const baseColumnInfo: ColumnDisplayInfo = {
      colName: 'name',
      autoIncrementColumns: [],
      defaultValueColumns: [],
      nullableColumns: [],
    };

    it('should return the cell value as-is for a regular column with data', () => {
      const result = resolveInsertionCellDisplay('John', baseColumnInfo);
      expect(result.displayValue).toBe('John');
      expect(result.hasPendingChange).toBe(true);
      expect(result.isModified).toBe(true);
      expect(result.isAutoIncrementPlaceholder).toBe(false);
      expect(result.isDefaultValuePlaceholder).toBe(false);
    });

    it('should mark isModified false when value is null', () => {
      const result = resolveInsertionCellDisplay(null, baseColumnInfo);
      expect(result.isModified).toBe(false);
    });

    it('should mark isModified false when value is empty string', () => {
      const result = resolveInsertionCellDisplay('', baseColumnInfo);
      expect(result.isModified).toBe(false);
    });

    it('should show <generated> placeholder for auto-increment column with null value', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'id',
        autoIncrementColumns: ['id'],
        defaultValueColumns: [],
        nullableColumns: [],
      };
      const result = resolveInsertionCellDisplay(null, columnInfo);
      expect(result.displayValue).toBe('<generated>');
      expect(result.isAutoIncrementPlaceholder).toBe(true);
      expect(result.isDefaultValuePlaceholder).toBe(false);
    });

    it('should show <generated> placeholder for auto-increment column with empty string', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'id',
        autoIncrementColumns: ['id'],
        defaultValueColumns: [],
        nullableColumns: [],
      };
      const result = resolveInsertionCellDisplay('', columnInfo);
      expect(result.displayValue).toBe('<generated>');
      expect(result.isAutoIncrementPlaceholder).toBe(true);
    });

    it('should not show <generated> for auto-increment column with a user-provided value', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'id',
        autoIncrementColumns: ['id'],
        defaultValueColumns: [],
        nullableColumns: [],
      };
      const result = resolveInsertionCellDisplay(42, columnInfo);
      expect(result.displayValue).toBe(42);
      expect(result.isAutoIncrementPlaceholder).toBe(false);
    });

    it('should show <default> placeholder for non-nullable default-value column with null', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'status',
        autoIncrementColumns: [],
        defaultValueColumns: ['status'],
        nullableColumns: [],
      };
      const result = resolveInsertionCellDisplay(null, columnInfo);
      expect(result.displayValue).toBe('<default>');
      expect(result.isDefaultValuePlaceholder).toBe(true);
      expect(result.isAutoIncrementPlaceholder).toBe(false);
    });

    it('should not show <default> for nullable default-value column with null', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'status',
        autoIncrementColumns: [],
        defaultValueColumns: ['status'],
        nullableColumns: ['status'],
      };
      const result = resolveInsertionCellDisplay(null, columnInfo);
      expect(result.displayValue).toBeNull();
      expect(result.isDefaultValuePlaceholder).toBe(false);
    });

    it('should prioritize auto-increment over default-value when column is in both lists', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'id',
        autoIncrementColumns: ['id'],
        defaultValueColumns: ['id'],
        nullableColumns: [],
      };
      const result = resolveInsertionCellDisplay(null, columnInfo);
      expect(result.displayValue).toBe('<generated>');
      expect(result.isAutoIncrementPlaceholder).toBe(true);
      expect(result.isDefaultValuePlaceholder).toBe(false);
    });

    it('should always set hasPendingChange to true for insertion rows', () => {
      const result = resolveInsertionCellDisplay(null, baseColumnInfo);
      expect(result.hasPendingChange).toBe(true);
    });
  });

  describe('resolveExistingCellDisplay', () => {
    const baseColumnInfo: ColumnDisplayInfo = {
      colName: 'name',
      autoIncrementColumns: [],
      defaultValueColumns: [],
      nullableColumns: [],
    };

    it('should return the original cell value when no pending changes exist', () => {
      const result = resolveExistingCellDisplay('John', '1', 'id', undefined, baseColumnInfo);
      expect(result.displayValue).toBe('John');
      expect(result.hasPendingChange).toBe(false);
      expect(result.isModified).toBe(false);
    });

    it('should return the pending value when a change exists for the column', () => {
      const pending = { '1': { pkOriginalValue: 1, changes: { name: 'Jane' } } };
      const result = resolveExistingCellDisplay('John', '1', 'id', pending, baseColumnInfo);
      expect(result.displayValue).toBe('Jane');
      expect(result.hasPendingChange).toBe(true);
      expect(result.isModified).toBe(true);
    });

    it('should not flag as modified when pending value equals original', () => {
      const pending = { '1': { pkOriginalValue: 1, changes: { name: 'John' } } };
      const result = resolveExistingCellDisplay('John', '1', 'id', pending, baseColumnInfo);
      expect(result.hasPendingChange).toBe(true);
      expect(result.isModified).toBe(false);
    });

    it('should resolve USE_DEFAULT_SENTINEL to <default> placeholder', () => {
      const pending = { '1': { pkOriginalValue: 1, changes: { name: USE_DEFAULT_SENTINEL } } };
      const result = resolveExistingCellDisplay('John', '1', 'id', pending, baseColumnInfo);
      expect(result.displayValue).toBe('<default>');
      expect(result.isDefaultValuePlaceholder).toBe(true);
    });

    it('should show <generated> for auto-increment column with null pending value', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'id',
        autoIncrementColumns: ['id'],
        defaultValueColumns: [],
        nullableColumns: [],
      };
      const pending = { '1': { pkOriginalValue: 1, changes: { id: null } } };
      const result = resolveExistingCellDisplay(1, '1', 'id', pending, columnInfo);
      expect(result.displayValue).toBe('<generated>');
      expect(result.isAutoIncrementPlaceholder).toBe(true);
    });

    it('should show <default> for non-nullable default-value column with empty pending value', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'status',
        autoIncrementColumns: [],
        defaultValueColumns: ['status'],
        nullableColumns: [],
      };
      const pending = { '1': { pkOriginalValue: 1, changes: { status: '' } } };
      const result = resolveExistingCellDisplay('active', '1', 'id', pending, columnInfo);
      expect(result.displayValue).toBe('<default>');
      expect(result.isDefaultValuePlaceholder).toBe(true);
    });

    it('should not show placeholder for nullable default-value column with null pending value', () => {
      const columnInfo: ColumnDisplayInfo = {
        colName: 'status',
        autoIncrementColumns: [],
        defaultValueColumns: ['status'],
        nullableColumns: ['status'],
      };
      const pending = { '1': { pkOriginalValue: 1, changes: { status: null } } };
      const result = resolveExistingCellDisplay('active', '1', 'id', pending, columnInfo);
      expect(result.displayValue).toBeNull();
      expect(result.isDefaultValuePlaceholder).toBe(false);
    });

    it('should return no pending change when pkColumn is null', () => {
      const pending = { '1': { pkOriginalValue: 1, changes: { name: 'Jane' } } };
      const result = resolveExistingCellDisplay('John', '1', null, pending, baseColumnInfo);
      expect(result.hasPendingChange).toBe(false);
      expect(result.displayValue).toBe('John');
    });

    it('should return no pending change when pkVal is null', () => {
      const pending = { '1': { pkOriginalValue: 1, changes: { name: 'Jane' } } };
      const result = resolveExistingCellDisplay('John', null, 'id', pending, baseColumnInfo);
      expect(result.hasPendingChange).toBe(false);
      expect(result.displayValue).toBe('John');
    });

    it('should return no pending change when row has no pending entry', () => {
      const pending = { '2': { pkOriginalValue: 2, changes: { name: 'Jane' } } };
      const result = resolveExistingCellDisplay('John', '1', 'id', pending, baseColumnInfo);
      expect(result.hasPendingChange).toBe(false);
      expect(result.displayValue).toBe('John');
    });
  });

  describe('getCellStateClass', () => {
    const baseParams: CellClassParams = {
      isPendingDelete: false,
      isSelected: false,
      isInsertion: false,
      isAutoIncrementPlaceholder: false,
      isDefaultValuePlaceholder: false,
      isModified: false,
    };

    it('should return default text class for unmodified existing row', () => {
      expect(getCellStateClass(baseParams)).toBe('text-secondary');
    });

    it('should return delete styling for pending-delete rows', () => {
      const result = getCellStateClass({ ...baseParams, isPendingDelete: true });
      expect(result).toContain('line-through');
      expect(result).toContain('text-red');
    });

    it('should prioritize pending-delete over all other states', () => {
      const result = getCellStateClass({
        ...baseParams,
        isPendingDelete: true,
        isSelected: true,
        isInsertion: true,
        isModified: true,
      });
      expect(result).toContain('line-through');
    });

    it('should return placeholder class for selected insertion with auto-increment', () => {
      const result = getCellStateClass({
        ...baseParams,
        isSelected: true,
        isInsertion: true,
        isAutoIncrementPlaceholder: true,
      });
      expect(result).toContain('text-muted');
      expect(result).toContain('italic');
    });

    it('should return placeholder class for selected insertion with default-value', () => {
      const result = getCellStateClass({
        ...baseParams,
        isSelected: true,
        isInsertion: true,
        isDefaultValuePlaceholder: true,
      });
      expect(result).toContain('text-muted');
      expect(result).toContain('italic');
    });

    it('should return modified class for selected insertion with user data', () => {
      const result = getCellStateClass({
        ...baseParams,
        isSelected: true,
        isInsertion: true,
        isModified: true,
      });
      expect(result).toContain('bg-blue');
      expect(result).toContain('italic');
    });

    it('should return unmodified insertion class for selected insertion without changes', () => {
      const result = getCellStateClass({
        ...baseParams,
        isSelected: true,
        isInsertion: true,
      });
      expect(result).toContain('italic');
      expect(result).toContain('text-secondary');
    });

    it('should return placeholder class for unselected insertion with auto-increment', () => {
      const result = getCellStateClass({
        ...baseParams,
        isInsertion: true,
        isAutoIncrementPlaceholder: true,
      });
      expect(result).toContain('text-muted');
      expect(result).toContain('italic');
    });

    it('should return modified insertion class for unselected insertion with user data', () => {
      const result = getCellStateClass({
        ...baseParams,
        isInsertion: true,
        isModified: true,
      });
      expect(result).toContain('bg-green');
      expect(result).toContain('italic');
    });

    it('should return unmodified insertion class for unselected insertion without changes', () => {
      const result = getCellStateClass({
        ...baseParams,
        isInsertion: true,
      });
      expect(result).toContain('bg-green');
      expect(result).toContain('text-secondary');
      expect(result).toContain('italic');
    });

    it('should return modified existing-row class for non-insertion modified cell', () => {
      const result = getCellStateClass({
        ...baseParams,
        isModified: true,
      });
      expect(result).toContain('bg-blue');
      expect(result).toContain('italic');
      expect(result).toContain('font-medium');
    });
  });
});
