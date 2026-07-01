import { describe, it, expect } from 'vitest';
import {
  serializeNotebook,
  deserializeNotebook,
  validateNotebookFile,
} from '../../src/utils/notebookFile';
import type { NotebookCell } from '../../src/types/notebook';

function makeCells(): NotebookCell[] {
  return [
    {
      id: 'cell-1',
      type: 'sql',
      content: 'SELECT * FROM users',
      result: { columns: ['id'], rows: [[1]], affected_rows: 0 },
      error: undefined,
      executionTime: 123,
      isLoading: false,
    },
    {
      id: 'cell-2',
      type: 'markdown',
      content: '# Report',
      result: null,
      error: undefined,
      executionTime: null,
      isLoading: false,
      isPreview: true,
    },
  ];
}

describe('notebookFile utils', () => {
  describe('serializeNotebook', () => {
    it('should produce correct structure', () => {
      const result = serializeNotebook('My Notebook', makeCells());
      expect(result.version).toBe(2);
      expect(result.title).toBe('My Notebook');
      expect(result.createdAt).toBeTruthy();
      expect(result.cells).toHaveLength(2);
    });

    it('should strip runtime data from cells', () => {
      const result = serializeNotebook('Test', makeCells());
      const cell = result.cells[0];
      expect(cell).toEqual({ type: 'sql', content: 'SELECT * FROM users' });
      expect(cell).not.toHaveProperty('id');
      expect(cell).not.toHaveProperty('result');
      expect(cell).not.toHaveProperty('error');
      expect(cell).not.toHaveProperty('executionTime');
      expect(cell).not.toHaveProperty('isLoading');
    });

    it('should handle empty cells array', () => {
      const result = serializeNotebook('Empty', []);
      expect(result.cells).toHaveLength(0);
    });

    it('should include stopOnError when true', () => {
      const result = serializeNotebook('Test', makeCells(), [], true);
      expect(result.stopOnError).toBe(true);
    });

    it('should omit stopOnError when false or undefined', () => {
      const result = serializeNotebook('Test', makeCells(), [], false);
      expect(result.stopOnError).toBeUndefined();

      const result2 = serializeNotebook('Test', makeCells());
      expect(result2.stopOnError).toBeUndefined();
    });

    it('should include isCollapsed when true', () => {
      const cells = makeCells();
      cells[0].isCollapsed = true;
      const result = serializeNotebook('Test', cells);
      expect(result.cells[0].isCollapsed).toBe(true);
      expect(result.cells[1].isCollapsed).toBeUndefined();
    });

    it('should include per-section collapse state when set', () => {
      const cells = makeCells();
      cells[0].isQueryCollapsed = true;
      cells[0].isResultCollapsed = true;
      cells[0].isChartVisible = false;
      const result = serializeNotebook('Test', cells);
      expect(result.cells[0].isQueryCollapsed).toBe(true);
      expect(result.cells[0].isResultCollapsed).toBe(true);
      expect(result.cells[0].isChartVisible).toBe(false);
    });

    it('should omit per-section collapse state when unset', () => {
      const result = serializeNotebook('Test', makeCells());
      expect(result.cells[0]).not.toHaveProperty('isQueryCollapsed');
      expect(result.cells[0]).not.toHaveProperty('isResultCollapsed');
      expect(result.cells[0]).not.toHaveProperty('isChartVisible');
    });

    it('should include cell name when set', () => {
      const cells = makeCells();
      cells[0].name = 'User Query';
      const result = serializeNotebook('Test', cells);
      expect(result.cells[0].name).toBe('User Query');
    });

    it('should include connectionId when provided', () => {
      const result = serializeNotebook('Test', makeCells(), undefined, undefined, 'conn_42');
      expect(result.connectionId).toBe('conn_42');
    });

    it('should omit connectionId when not provided', () => {
      const result = serializeNotebook('Test', makeCells());
      expect(result.connectionId).toBeUndefined();
    });
  });

  describe('validateNotebookFile', () => {
    it('should return true for valid notebook file', () => {
      const data = {
        version: 1,
        title: 'Test',
        createdAt: '2026-01-01',
        cells: [
          { type: 'sql', content: 'SELECT 1' },
          { type: 'markdown', content: '# Title' },
        ],
      };
      expect(validateNotebookFile(data)).toBe(true);
    });

    it('should return true for version 2 with new fields', () => {
      const data = {
        version: 2,
        title: 'Test',
        createdAt: '2026-01-01',
        cells: [
          { type: 'sql', content: 'SELECT 1', isCollapsed: true },
        ],
        stopOnError: true,
      };
      expect(validateNotebookFile(data)).toBe(true);
    });

    it('should return false for null', () => {
      expect(validateNotebookFile(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(validateNotebookFile('string')).toBe(false);
      expect(validateNotebookFile(42)).toBe(false);
    });

    it('should return false for missing version', () => {
      expect(validateNotebookFile({ title: 'T', cells: [] })).toBe(false);
    });

    it('should return false for missing title', () => {
      expect(validateNotebookFile({ version: 1, cells: [] })).toBe(false);
    });

    it('should return false for missing cells', () => {
      expect(validateNotebookFile({ version: 1, title: 'T' })).toBe(false);
    });

    it('should return false for invalid cell type', () => {
      const data = {
        version: 1,
        title: 'T',
        createdAt: '',
        cells: [{ type: 'invalid', content: '' }],
      };
      expect(validateNotebookFile(data)).toBe(false);
    });

    it('should return false for cell without content', () => {
      const data = {
        version: 1,
        title: 'T',
        createdAt: '',
        cells: [{ type: 'sql' }],
      };
      expect(validateNotebookFile(data)).toBe(false);
    });
  });

  describe('deserializeNotebook', () => {
    it('should parse valid JSON and generate cell IDs', () => {
      const json = JSON.stringify({
        version: 1,
        title: 'My Notebook',
        createdAt: '2026-01-01',
        cells: [
          { type: 'sql', content: 'SELECT 1' },
          { type: 'markdown', content: '# Title' },
        ],
      });

      const result = deserializeNotebook(json);
      expect(result.title).toBe('My Notebook');
      expect(result.cells).toHaveLength(2);
      expect(result.cells[0].id).toMatch(/^cell_/);
      expect(result.cells[0].type).toBe('sql');
      expect(result.cells[0].content).toBe('SELECT 1');
      expect(result.cells[0].result).toBeNull();
      expect(result.cells[0].isLoading).toBe(false);
    });

    it('should set isPreview to true for markdown cells', () => {
      const json = JSON.stringify({
        version: 1,
        title: 'T',
        createdAt: '',
        cells: [{ type: 'markdown', content: '# Hi' }],
      });
      const result = deserializeNotebook(json);
      expect(result.cells[0].isPreview).toBe(true);
    });

    it('should set isPreview to undefined for SQL cells', () => {
      const json = JSON.stringify({
        version: 1,
        title: 'T',
        createdAt: '',
        cells: [{ type: 'sql', content: 'SELECT 1' }],
      });
      const result = deserializeNotebook(json);
      expect(result.cells[0].isPreview).toBeUndefined();
    });

    it('should throw on invalid JSON', () => {
      expect(() => deserializeNotebook('not json')).toThrow('Invalid JSON');
    });

    it('should throw on invalid notebook structure', () => {
      expect(() => deserializeNotebook('{}')).toThrow('Invalid notebook file format');
    });

    it('should throw on missing version', () => {
      const json = JSON.stringify({ title: 'T', cells: [] });
      expect(() => deserializeNotebook(json)).toThrow('Invalid notebook file format');
    });

    it('should deserialize stopOnError from version 2', () => {
      const json = JSON.stringify({
        version: 2,
        title: 'T',
        createdAt: '',
        cells: [{ type: 'sql', content: 'SELECT 1' }],
        stopOnError: true,
      });
      const result = deserializeNotebook(json);
      expect(result.stopOnError).toBe(true);
    });

    it('should deserialize isCollapsed per cell', () => {
      const json = JSON.stringify({
        version: 2,
        title: 'T',
        createdAt: '',
        cells: [
          { type: 'sql', content: 'SELECT 1', isCollapsed: true },
          { type: 'sql', content: 'SELECT 2' },
        ],
      });
      const result = deserializeNotebook(json);
      expect(result.cells[0].isCollapsed).toBe(true);
      expect(result.cells[1].isCollapsed).toBeUndefined();
    });

    it('should deserialize per-section collapse state', () => {
      const json = JSON.stringify({
        version: 2,
        title: 'T',
        createdAt: '',
        cells: [
          {
            type: 'sql',
            content: 'SELECT 1',
            isQueryCollapsed: true,
            isResultCollapsed: true,
            isChartVisible: false,
          },
          { type: 'sql', content: 'SELECT 2' },
        ],
      });
      const result = deserializeNotebook(json);
      expect(result.cells[0].isQueryCollapsed).toBe(true);
      expect(result.cells[0].isResultCollapsed).toBe(true);
      expect(result.cells[0].isChartVisible).toBe(false);
      expect(result.cells[1].isQueryCollapsed).toBeUndefined();
      expect(result.cells[1].isResultCollapsed).toBeUndefined();
      expect(result.cells[1].isChartVisible).toBeUndefined();
    });

    it('should handle version 1 without new fields (backward compat)', () => {
      const json = JSON.stringify({
        version: 1,
        title: 'Old Notebook',
        createdAt: '2025-01-01',
        cells: [{ type: 'sql', content: 'SELECT 1' }],
      });
      const result = deserializeNotebook(json);
      expect(result.stopOnError).toBeUndefined();
      expect(result.cells[0].isCollapsed).toBeUndefined();
    });
  });

  describe('params serialization', () => {
    it('should include params when provided', () => {
      const params = [{ name: 'start', value: "'2026-01-01'" }];
      const result = serializeNotebook('Test', makeCells(), params);
      expect(result.params).toEqual(params);
    });

    it('should omit params when empty', () => {
      const result = serializeNotebook('Test', makeCells(), []);
      expect(result.params).toBeUndefined();
    });

    it('should include cell schema when set', () => {
      const cells = makeCells();
      cells[0].schema = 'my_database';
      const result = serializeNotebook('Test', cells);
      expect(result.cells[0].schema).toBe('my_database');
    });
  });

  describe('round-trip', () => {
    it('should preserve content through serialize → deserialize', () => {
      const cells = makeCells();
      const serialized = serializeNotebook('Round Trip', cells);
      const json = JSON.stringify(serialized);
      const { title, cells: restoredCells } = deserializeNotebook(json);

      expect(title).toBe('Round Trip');
      expect(restoredCells).toHaveLength(2);
      expect(restoredCells[0].type).toBe('sql');
      expect(restoredCells[0].content).toBe('SELECT * FROM users');
      expect(restoredCells[1].type).toBe('markdown');
      expect(restoredCells[1].content).toBe('# Report');
    });

    it('should preserve params and schema through round-trip', () => {
      const cells = makeCells();
      cells[0].schema = 'production_db';
      const params = [{ name: 'limit', value: '50' }];
      const serialized = serializeNotebook('Full', cells, params);
      const json = JSON.stringify(serialized);
      const result = deserializeNotebook(json);

      expect(result.params).toEqual(params);
      expect(result.cells[0].schema).toBe('production_db');
    });

    it('should handle notebook without params', () => {
      const serialized = serializeNotebook('Bare', makeCells());
      const json = JSON.stringify(serialized);
      const result = deserializeNotebook(json);

      expect(result.params).toBeUndefined();
    });

    it('should preserve stopOnError and isCollapsed through round-trip', () => {
      const cells = makeCells();
      cells[0].isCollapsed = true;
      const serialized = serializeNotebook('Full', cells, [], true);
      const json = JSON.stringify(serialized);
      const result = deserializeNotebook(json);

      expect(result.stopOnError).toBe(true);
      expect(result.cells[0].isCollapsed).toBe(true);
      expect(result.cells[1].isCollapsed).toBeUndefined();
    });

    it('should preserve per-section collapse state through round-trip', () => {
      const cells = makeCells();
      cells[0].isQueryCollapsed = true;
      cells[0].isResultCollapsed = true;
      cells[0].isChartVisible = false;
      const serialized = serializeNotebook('Full', cells);
      const json = JSON.stringify(serialized);
      const result = deserializeNotebook(json);

      expect(result.cells[0].isQueryCollapsed).toBe(true);
      expect(result.cells[0].isResultCollapsed).toBe(true);
      expect(result.cells[0].isChartVisible).toBe(false);
      expect(result.cells[1].isQueryCollapsed).toBeUndefined();
      expect(result.cells[1].isResultCollapsed).toBeUndefined();
      expect(result.cells[1].isChartVisible).toBeUndefined();
    });
  });
});
