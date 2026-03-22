import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rowToTSV,
  rowsToTSV,
  rowToJSON,
  rowsToJSON,
  getSelectedRows,
  copyTextToClipboard
} from '../../src/utils/clipboard';

describe('clipboard utils', () => {
  describe('rowToTSV', () => {
    it('should convert a simple row to TSV format', () => {
      const row = [1, 'test', true];
      expect(rowToTSV(row)).toBe('1\ttest\ttrue');
    });

    it('should handle null values with default label', () => {
      const row = [1, null, 'test'];
      expect(rowToTSV(row)).toBe('1\tnull\ttest');
    });

    it('should handle null values with custom label', () => {
      const row = [1, null, 'test'];
      expect(rowToTSV(row, 'NULL')).toBe('1\tNULL\ttest');
    });

    it('should handle undefined values', () => {
      const row = [1, undefined, 'test'];
      expect(rowToTSV(row)).toBe('1\tnull\ttest');
    });

    it('should handle empty row', () => {
      const row: unknown[] = [];
      expect(rowToTSV(row)).toBe('');
    });

    it('should handle objects by converting to JSON', () => {
      const row = [1, { name: 'test' }, 'value'];
      expect(rowToTSV(row)).toBe('1\t{"name":"test"}\tvalue');
    });

    it('should handle boolean values', () => {
      const row = [true, false, null];
      expect(rowToTSV(row)).toBe('true\tfalse\tnull');
    });
  });

  describe('rowsToTSV', () => {
    it('should convert multiple rows to TSV with newlines', () => {
      const rows = [
        [1, 'Alice', 25],
        [2, 'Bob', 30],
        [3, 'Charlie', 35]
      ];
      expect(rowsToTSV(rows)).toBe(
        '1\tAlice\t25\n2\tBob\t30\n3\tCharlie\t35'
      );
    });

    it('should handle null values in multiple rows', () => {
      const rows = [
        [1, null, 'test'],
        [2, 'value', null]
      ];
      expect(rowsToTSV(rows)).toBe('1\tnull\ttest\n2\tvalue\tnull');
    });

    it('should handle empty rows array', () => {
      const rows: unknown[][] = [];
      expect(rowsToTSV(rows)).toBe('');
    });

    it('should handle single row', () => {
      const rows = [[1, 'test', true]];
      expect(rowsToTSV(rows)).toBe('1\ttest\ttrue');
    });

    it('should use custom null label', () => {
      const rows = [
        [1, null],
        [2, 'value']
      ];
      expect(rowsToTSV(rows, 'NULL')).toBe('1\tNULL\n2\tvalue');
    });
  });

  describe('rowToJSON', () => {
    it('should convert a row to a JSON object string', () => {
      const row = [1, 'John Doe', 'john@example.com'];
      const columns = ['id', 'name', 'email'];
      expect(rowToJSON(row, columns)).toBe('{"id":1,"name":"John Doe","email":"john@example.com"}');
    });

    it('should handle null values', () => {
      const row = [1, null, 'test'];
      const columns = ['id', 'name', 'value'];
      expect(rowToJSON(row, columns)).toBe('{"id":1,"name":null,"value":"test"}');
    });

    it('should handle undefined values as null', () => {
      const row = [1, undefined];
      const columns = ['id', 'name'];
      expect(rowToJSON(row, columns)).toBe('{"id":1,"name":null}');
    });

    it('should handle boolean values', () => {
      const row = [true, false];
      const columns = ['active', 'deleted'];
      expect(rowToJSON(row, columns)).toBe('{"active":true,"deleted":false}');
    });

    it('should handle object values', () => {
      const row = [1, { nested: 'value' }];
      const columns = ['id', 'data'];
      expect(rowToJSON(row, columns)).toBe('{"id":1,"data":{"nested":"value"}}');
    });

    it('should handle empty row', () => {
      expect(rowToJSON([], [])).toBe('{}');
    });
  });

  describe('rowsToJSON', () => {
    it('should convert multiple rows to a JSON array string', () => {
      const rows = [
        [1, 'Alice'],
        [2, 'Bob'],
      ];
      const columns = ['id', 'name'];
      expect(rowsToJSON(rows, columns)).toBe('[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]');
    });

    it('should handle single row', () => {
      const rows = [[1, 'test']];
      const columns = ['id', 'value'];
      expect(rowsToJSON(rows, columns)).toBe('[{"id":1,"value":"test"}]');
    });

    it('should handle empty rows array', () => {
      expect(rowsToJSON([], ['id'])).toBe('[]');
    });

    it('should handle null values in rows', () => {
      const rows = [
        [1, null],
        [2, 'value'],
      ];
      const columns = ['id', 'name'];
      expect(rowsToJSON(rows, columns)).toBe('[{"id":1,"name":null},{"id":2,"name":"value"}]');
    });
  });

  describe('getSelectedRows', () => {
    const data = [
      [1, 'row1'],
      [2, 'row2'],
      [3, 'row3'],
      [4, 'row4'],
      [5, 'row5']
    ];

    it('should return selected rows in sorted order', () => {
      const selected = new Set([2, 0, 4]);
      const result = getSelectedRows(data, selected);
      
      expect(result).toEqual([
        [1, 'row1'],
        [3, 'row3'],
        [5, 'row5']
      ]);
    });

    it('should handle single selection', () => {
      const selected = new Set([2]);
      const result = getSelectedRows(data, selected);
      
      expect(result).toEqual([[3, 'row3']]);
    });

    it('should handle empty selection', () => {
      const selected = new Set<number>();
      const result = getSelectedRows(data, selected);
      
      expect(result).toEqual([]);
    });

    it('should handle all rows selected', () => {
      const selected = new Set([0, 1, 2, 3, 4]);
      const result = getSelectedRows(data, selected);
      
      expect(result).toEqual(data);
    });

    it('should sort indices even if provided out of order', () => {
      const selected = new Set([4, 1, 3]);
      const result = getSelectedRows(data, selected);
      
      expect(result).toEqual([
        [2, 'row2'],
        [4, 'row4'],
        [5, 'row5']
      ]);
    });
  });

  describe('copyTextToClipboard', () => {
    beforeEach(() => {
      // Mock clipboard API
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn(),
        },
      });
    });

    it('should copy text to clipboard', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator.clipboard, { writeText: mockWriteText });

      await copyTextToClipboard('test text');

      expect(mockWriteText).toHaveBeenCalledWith('test text');
    });

    it('should call error handler on failure', async () => {
      const error = new Error('Clipboard error');
      const mockWriteText = vi.fn().mockRejectedValue(error);
      Object.assign(navigator.clipboard, { writeText: mockWriteText });

      const onError = vi.fn();
      await copyTextToClipboard('test', onError);

      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should throw error if no error handler provided', async () => {
      const error = new Error('Clipboard error');
      const mockWriteText = vi.fn().mockRejectedValue(error);
      Object.assign(navigator.clipboard, { writeText: mockWriteText });

      await expect(copyTextToClipboard('test')).rejects.toThrow('Clipboard error');
    });

    it('should handle empty string', async () => {
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator.clipboard, { writeText: mockWriteText });

      await copyTextToClipboard('');

      expect(mockWriteText).toHaveBeenCalledWith('');
    });
  });
});
