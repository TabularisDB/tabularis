import { describe, it, expect } from 'vitest';
import {
  generateCellId,
  createEmptyCell,
  createDefaultNotebookState,
  updateCellInCells,
  addCellToCells,
  removeCellFromCells,
  moveCellInCells,
  extractSqlFromCells,
} from '../../src/utils/notebook';
import type { NotebookCell } from '../../src/types/notebook';

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
  return {
    id: overrides.id ?? 'cell-1',
    type: overrides.type ?? 'sql',
    content: overrides.content ?? '',
    result: null,
    error: undefined,
    executionTime: null,
    isLoading: false,
    ...overrides,
  };
}

describe('notebook utils', () => {
  describe('generateCellId', () => {
    it('should return a non-empty string', () => {
      const id = generateCellId();
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should start with cell_ prefix', () => {
      expect(generateCellId()).toMatch(/^cell_/);
    });

    it('should generate unique ids across calls', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateCellId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('createEmptyCell', () => {
    it('should create an empty SQL cell with correct defaults', () => {
      const cell = createEmptyCell('sql');
      expect(cell.type).toBe('sql');
      expect(cell.content).toBe('');
      expect(cell.result).toBeNull();
      expect(cell.error).toBeUndefined();
      expect(cell.executionTime).toBeNull();
      expect(cell.isLoading).toBe(false);
      expect(cell.isPreview).toBeUndefined();
      expect(cell.id).toMatch(/^cell_/);
    });

    it('should create an empty markdown cell with isPreview = false', () => {
      const cell = createEmptyCell('markdown');
      expect(cell.type).toBe('markdown');
      expect(cell.content).toBe('');
      expect(cell.isPreview).toBe(false);
      expect(cell.id).toMatch(/^cell_/);
    });
  });

  describe('createDefaultNotebookState', () => {
    it('should return state with one empty SQL cell', () => {
      const state = createDefaultNotebookState();
      expect(state.cells).toHaveLength(1);
      expect(state.cells[0].type).toBe('sql');
      expect(state.cells[0].content).toBe('');
    });
  });

  describe('updateCellInCells', () => {
    it('should update the target cell', () => {
      const cells = [makeCell({ id: 'a' }), makeCell({ id: 'b' })];
      const updated = updateCellInCells(cells, 'a', { content: 'SELECT 1' });
      expect(updated[0].content).toBe('SELECT 1');
      expect(updated[1].content).toBe('');
    });

    it('should leave other cells unchanged', () => {
      const cells = [makeCell({ id: 'a', content: 'original' }), makeCell({ id: 'b', content: 'other' })];
      const updated = updateCellInCells(cells, 'a', { content: 'changed' });
      expect(updated[1].content).toBe('other');
    });

    it('should return unchanged array if cellId not found', () => {
      const cells = [makeCell({ id: 'a' })];
      const updated = updateCellInCells(cells, 'missing', { content: 'x' });
      expect(updated).toEqual(cells);
    });
  });

  describe('addCellToCells', () => {
    it('should add cell at the end by default', () => {
      const cells = [makeCell({ id: 'a' })];
      const result = addCellToCells(cells, 'sql');
      expect(result).toHaveLength(2);
      expect(result[1].type).toBe('sql');
    });

    it('should add cell after specified index', () => {
      const cells = [makeCell({ id: 'a' }), makeCell({ id: 'b' })];
      const result = addCellToCells(cells, 'markdown', 0);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('a');
      expect(result[1].type).toBe('markdown');
      expect(result[2].id).toBe('b');
    });

    it('should work with empty array', () => {
      const result = addCellToCells([], 'sql');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('sql');
    });
  });

  describe('removeCellFromCells', () => {
    it('should remove the target cell', () => {
      const cells = [makeCell({ id: 'a' }), makeCell({ id: 'b' })];
      const result = removeCellFromCells(cells, 'a');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('b');
    });

    it('should return unchanged array if cellId not found', () => {
      const cells = [makeCell({ id: 'a' })];
      const result = removeCellFromCells(cells, 'missing');
      expect(result).toHaveLength(1);
    });

    it('should return empty array when removing last cell', () => {
      const cells = [makeCell({ id: 'a' })];
      const result = removeCellFromCells(cells, 'a');
      expect(result).toHaveLength(0);
    });
  });

  describe('moveCellInCells', () => {
    it('should swap cells when moving down', () => {
      const cells = [makeCell({ id: 'a' }), makeCell({ id: 'b' }), makeCell({ id: 'c' })];
      const result = moveCellInCells(cells, 'a', 1);
      expect(result.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    });

    it('should swap cells when moving up', () => {
      const cells = [makeCell({ id: 'a' }), makeCell({ id: 'b' }), makeCell({ id: 'c' })];
      const result = moveCellInCells(cells, 'c', -1);
      expect(result.map((c) => c.id)).toEqual(['a', 'c', 'b']);
    });

    it('should no-op when moving first cell up', () => {
      const cells = [makeCell({ id: 'a' }), makeCell({ id: 'b' })];
      const result = moveCellInCells(cells, 'a', -1);
      expect(result.map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('should no-op when moving last cell down', () => {
      const cells = [makeCell({ id: 'a' }), makeCell({ id: 'b' })];
      const result = moveCellInCells(cells, 'b', 1);
      expect(result.map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('should return unchanged array if cellId not found', () => {
      const cells = [makeCell({ id: 'a' })];
      const result = moveCellInCells(cells, 'missing', 1);
      expect(result).toEqual(cells);
    });
  });

  describe('extractSqlFromCells', () => {
    it('should join SQL cell contents with double newline', () => {
      const cells = [
        makeCell({ id: 'a', type: 'sql', content: 'SELECT 1' }),
        makeCell({ id: 'b', type: 'sql', content: 'SELECT 2' }),
      ];
      expect(extractSqlFromCells(cells)).toBe('SELECT 1\n\nSELECT 2');
    });

    it('should skip markdown cells', () => {
      const cells = [
        makeCell({ id: 'a', type: 'sql', content: 'SELECT 1' }),
        makeCell({ id: 'b', type: 'markdown', content: '# Title' }),
        makeCell({ id: 'c', type: 'sql', content: 'SELECT 2' }),
      ];
      expect(extractSqlFromCells(cells)).toBe('SELECT 1\n\nSELECT 2');
    });

    it('should skip empty SQL cells', () => {
      const cells = [
        makeCell({ id: 'a', type: 'sql', content: 'SELECT 1' }),
        makeCell({ id: 'b', type: 'sql', content: '   ' }),
        makeCell({ id: 'c', type: 'sql', content: 'SELECT 2' }),
      ];
      expect(extractSqlFromCells(cells)).toBe('SELECT 1\n\nSELECT 2');
    });

    it('should return empty string when no SQL cells', () => {
      const cells = [makeCell({ id: 'a', type: 'markdown', content: '# Title' })];
      expect(extractSqlFromCells(cells)).toBe('');
    });

    it('should return empty string for empty array', () => {
      expect(extractSqlFromCells([])).toBe('');
    });
  });
});
