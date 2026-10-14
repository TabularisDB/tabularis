import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  rowToCSV,
  rowsToCSV,
  rowsToCSVWithHeaders,
  rowToJSON,
  rowsToJSON,
  columnValuesForCopy,
  columnValuesToInClause,
  getSelectedRows,
  copyTextToClipboard,
  rowsToHtmlTable,
  columnNamesAsLines,
  columnNamesAsJson,
} from '../../src/utils/clipboard';

describe('clipboard utils', () => {
  describe('rowToCSV', () => {
    it('should convert a simple row with default comma delimiter', () => {
      const row = [1, 'test', true];
      expect(rowToCSV(row)).toBe('1,test,true');
    });

    it('should handle null values with default label', () => {
      const row = [1, null, 'test'];
      expect(rowToCSV(row)).toBe('1,null,test');
    });

    it('should handle null values with custom label', () => {
      const row = [1, null, 'test'];
      expect(rowToCSV(row, 'NULL')).toBe('1,NULL,test');
    });

    it('should handle undefined values', () => {
      const row = [1, undefined, 'test'];
      expect(rowToCSV(row)).toBe('1,null,test');
    });

    it('should handle empty row', () => {
      const row: unknown[] = [];
      expect(rowToCSV(row)).toBe('');
    });

    it('should handle objects by converting to JSON', () => {
      const row = [1, { name: 'test' }, 'value'];
      // The JSON text has quotes, so the CSV field is quoted with them doubled.
      expect(rowToCSV(row)).toBe('1,"{""name"":""test""}",value');
    });

    it('should handle boolean values', () => {
      const row = [true, false, null];
      expect(rowToCSV(row)).toBe('true,false,null');
    });

    it('should use tab delimiter', () => {
      const row = [1, 'test', true];
      expect(rowToCSV(row, 'null', '\t')).toBe('1\ttest\ttrue');
    });

    it('should use semicolon delimiter', () => {
      const row = [1, 'test', true];
      expect(rowToCSV(row, 'null', ';')).toBe('1;test;true');
    });

    it('should use pipe delimiter', () => {
      const row = [1, 'test', true];
      expect(rowToCSV(row, 'null', '|')).toBe('1|test|true');
    });
  });

  describe('rowsToCSV', () => {
    it('should convert multiple rows with default comma delimiter', () => {
      const rows = [
        [1, 'Alice', 25],
        [2, 'Bob', 30],
        [3, 'Charlie', 35]
      ];
      expect(rowsToCSV(rows)).toBe(
        '1,Alice,25\n2,Bob,30\n3,Charlie,35'
      );
    });

    it('should handle null values in multiple rows', () => {
      const rows = [
        [1, null, 'test'],
        [2, 'value', null]
      ];
      expect(rowsToCSV(rows)).toBe('1,null,test\n2,value,null');
    });

    it('should handle empty rows array', () => {
      const rows: unknown[][] = [];
      expect(rowsToCSV(rows)).toBe('');
    });

    it('should handle single row', () => {
      const rows = [[1, 'test', true]];
      expect(rowsToCSV(rows)).toBe('1,test,true');
    });

    it('should use custom null label', () => {
      const rows = [
        [1, null],
        [2, 'value']
      ];
      expect(rowsToCSV(rows, 'NULL')).toBe('1,NULL\n2,value');
    });

    it('should use semicolon delimiter', () => {
      const rows = [
        [1, 'Alice'],
        [2, 'Bob']
      ];
      expect(rowsToCSV(rows, 'null', ';')).toBe('1;Alice\n2;Bob');
    });

    it('should use tab delimiter', () => {
      const rows = [
        [1, 'Alice'],
        [2, 'Bob']
      ];
      expect(rowsToCSV(rows, 'null', '\t')).toBe('1\tAlice\n2\tBob');
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

  describe('rowsToHtmlTable', () => {
    it('should build a table with a header row and one row per record', () => {
      const rows = [
        [1, 'Alice'],
        [2, 'Bob'],
      ];
      expect(rowsToHtmlTable(rows, ['id', 'name'])).toBe(
        '<table><thead><tr><th>id</th><th>name</th></tr></thead>' +
          '<tbody><tr><td>1</td><td>Alice</td></tr><tr><td>2</td><td>Bob</td></tr></tbody></table>'
      );
    });

    it('should escape HTML special characters in values and headers', () => {
      const rows = [['<b>Tom & "Jerry"</b>', "it's"]];
      expect(rowsToHtmlTable(rows, ['a<b', 'c&d'])).toBe(
        '<table><thead><tr><th>a&lt;b</th><th>c&amp;d</th></tr></thead>' +
          '<tbody><tr><td>&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;</td><td>it&#39;s</td></tr></tbody></table>'
      );
    });

    it('should use the given NULL label for null and undefined values', () => {
      expect(rowsToHtmlTable([[null, undefined]], ['a', 'b'], 'NULL')).toBe(
        '<table><thead><tr><th>a</th><th>b</th></tr></thead>' +
          '<tbody><tr><td>NULL</td><td>NULL</td></tr></tbody></table>'
      );
    });

    it('should default the NULL label to "null"', () => {
      expect(rowsToHtmlTable([[null]], ['a'])).toContain('<td>null</td>');
    });

    it('should format booleans and objects like the other copy formats', () => {
      expect(rowsToHtmlTable([[true, { k: 1 }]], ['flag', 'data'])).toContain(
        '<td>true</td><td>{&quot;k&quot;:1}</td>'
      );
    });

    it('should keep line breaks inside a cell', () => {
      expect(rowsToHtmlTable([['line1\nline2\r\nline3']], ['text'])).toContain(
        '<td>line1<br>line2<br>line3</td>'
      );
    });

    it('should return only the header row when there are no rows', () => {
      expect(rowsToHtmlTable([], ['id'])).toBe(
        '<table><thead><tr><th>id</th></tr></thead><tbody></tbody></table>'
      );
    });
  });

  describe('columnNamesAsLines', () => {
    it('should format multiple column names in grid order', () => {
      const columns = ['id', 'name', 'email'];
      expect(columnNamesAsLines(columns)).toBe('id\nname\nemail');
    });

    it('should handle single column name', () => {
      expect(columnNamesAsLines(['id'])).toBe('id');
    });

    it('should return empty string for empty array', () => {
      expect(columnNamesAsLines([])).toBe('');
    });

    it('should handle columns with empty names', () => {
      const columns = ['id', '', 'email'];
      expect(columnNamesAsLines(columns)).toBe('id\n\nemail');
    });
  });

  describe('columnNamesAsJson', () => {
    it('should format multiple columns in grid order as JSON array', () => {
      const columns = ['id', 'name', 'email'];
      expect(columnNamesAsJson(columns)).toBe('["id","name","email"]');
    });

    it('should handle single column name', () => {
      expect(columnNamesAsJson(['id'])).toBe('["id"]');
    });

    it('should return empty array string for empty columns array', () => {
      expect(columnNamesAsJson([])).toBe('[]');
    });

    it('should handle columns with empty names', () => {
      const columns = ['id', '', 'email'];
      expect(columnNamesAsJson(columns)).toBe('["id","","email"]');
    });

    it('should escape quotes and backslashes in column names', () => {
      const columns = ['col"name', 'col\\name'];
      expect(columnNamesAsJson(columns)).toBe('["col\\"name","col\\\\name"]');
    });

    it('should produce valid JSON parseable back to the original array', () => {
      const columns = ['id', 'user"name', 'path\\to\\field', '', 'email'];
      const jsonStr = columnNamesAsJson(columns);
      expect(JSON.parse(jsonStr)).toEqual(columns);
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

  describe('columnValuesForCopy', () => {
    const rows = [
      [1, 'Alice'],
      [2, "O'Brien"],
      [3, null],
    ];
    const columns = ['id', 'name'];

    it('should use the configured CSV header setting', () => {
      expect(
        columnValuesForCopy(rows, columns, 1, {
          format: 'csv',
          delimiter: ';',
          includeHeader: true,
        }),
      ).toBe("name\nAlice\nO'Brien\nnull");

      expect(
        columnValuesForCopy(rows, columns, 0, {
          format: 'csv',
          includeHeader: false,
        }),
      ).toBe('1\n2\n3');
    });

    it('should format the selected column as JSON', () => {
      expect(
        columnValuesForCopy(rows, columns, 1, { format: 'json' }),
      ).toBe('[{"name":"Alice"},{"name":"O\'Brien"},{"name":null}]');
    });

    it('should format the selected column as SQL INSERT statements', () => {
      expect(
        columnValuesForCopy(rows, columns, 1, {
          format: 'sql-insert',
          tableName: 'users',
        }),
      ).toBe(
        "INSERT INTO `users` (`name`) VALUES ('Alice');\n" +
          "INSERT INTO `users` (`name`) VALUES ('O''Brien');\n" +
          'INSERT INTO `users` (`name`) VALUES (NULL);',
      );
    });

    it('should format the selected column as Markdown', () => {
      expect(
        columnValuesForCopy(rows, columns, 1, {
          format: 'markdown',
          includeHeader: true,
        }),
      ).toBe(
        '| name |\n| --- |\n| Alice |\n| O\'Brien |\n| null |',
      );
    });

    it('should return an empty string for an unknown column', () => {
      expect(
        columnValuesForCopy(rows, columns, -1, { format: 'csv' }),
      ).toBe('');
    });
  });

  describe('columnValuesToInClause', () => {
    it('should quote strings, escape quotes, and preserve SQL literals', () => {
      const rows = [
        [1, 'Alice'],
        [2, "O'Brien"],
        [3, null],
        [4, true],
      ];

      expect(columnValuesToInClause(rows, 0)).toBe('1, 2, 3, 4');
      expect(columnValuesToInClause(rows, 1)).toBe(
        "'Alice', 'O''Brien', NULL, TRUE",
      );
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

describe('CSV clipboard quoting', () => {
  it('quotes a value that contains the delimiter', () => {
    expect(rowToCSV(['Rome, Italy', 3])).toBe('"Rome, Italy",3');
  });

  it('quotes a value with a double quote and doubles the quote', () => {
    expect(rowToCSV(['say "hi"'])).toBe('"say ""hi"""');
  });

  it('quotes a value with a lone carriage return, as the file export does', () => {
    expect(rowsToCSV([['hello\rworld', 'x']])).toBe('"hello\rworld",x');
  });

  it('quotes a value with a line break', () => {
    expect(rowsToCSV([['line1\nline2', 'x']])).toBe('"line1\nline2",x');
  });

  it('leaves plain values unquoted', () => {
    expect(rowsToCSV([['a', 1, null]])).toBe('a,1,null');
  });

  it('quotes header names the same way as the body', () => {
    expect(rowsToCSVWithHeaders([['Rome, Italy']], ['city, name'])).toBe('"city, name"\n"Rome, Italy"');
  });
});
