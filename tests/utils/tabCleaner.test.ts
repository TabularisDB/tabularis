import { describe, it, expect } from 'vitest';
import { cleanTabForStorage, restoreTabFromStorage } from '../../src/utils/tabCleaner';
import type { Tab } from '../../src/types/editor';

describe('tabCleaner', () => {
  describe('cleanTabForStorage', () => {
    it('should preserve persistent fields', () => {
      const tab: Tab = {
        id: 'tab-123',
        title: 'My Query',
        type: 'console',
        query: 'SELECT * FROM users',
        page: 2,
        activeTable: 'users',
        pkColumns: ['id'],
        connectionId: 'conn-456',
        isEditorOpen: true,
        filterClause: 'age > 18',
        sortClause: 'name ASC',
        limitClause: 100,
        queryParams: { param1: 'value1' },
        // Temporary fields that should be excluded
        result: { columns: ['id'], rows: [[1]], affected_rows: 0 },
        error: 'Some error',
        executionTime: 123,
        isLoading: true,
        pendingChanges: { '1': { pkOriginalValue: 1, changes: { name: 'new' } } },
        pendingDeletions: { '1': 1 },
        selectedRows: [0, 1, 2],
      };

      const cleaned = cleanTabForStorage(tab);

      // Should include persistent fields
      expect(cleaned.id).toBe('tab-123');
      expect(cleaned.title).toBe('My Query');
      expect(cleaned.type).toBe('console');
      expect(cleaned.query).toBe('SELECT * FROM users');
      expect(cleaned.page).toBe(2);
      expect(cleaned.activeTable).toBe('users');
      expect(cleaned.pkColumns).toEqual(['id']);
      expect(cleaned.connectionId).toBe('conn-456');
      expect(cleaned.isEditorOpen).toBe(true);
      expect(cleaned.filterClause).toBe('age > 18');
      expect(cleaned.sortClause).toBe('name ASC');
      expect(cleaned.limitClause).toBe(100);
      expect(cleaned.queryParams).toEqual({ param1: 'value1' });

      // Should NOT include temporary fields
      expect(cleaned).not.toHaveProperty('result');
      expect(cleaned).not.toHaveProperty('error');
      expect(cleaned).not.toHaveProperty('executionTime');
      expect(cleaned).not.toHaveProperty('isLoading');
      expect(cleaned).not.toHaveProperty('pendingChanges');
      expect(cleaned).not.toHaveProperty('pendingDeletions');
      expect(cleaned).not.toHaveProperty('selectedRows');
    });

    it('should handle null values for optional fields', () => {
      const tab: Tab = {
        id: 'tab-123',
        title: 'Console',
        type: 'console',
        query: '',
        page: 1,
        activeTable: null,
        pkColumns: null,
        connectionId: 'conn-456',
        result: null,
        error: '',
        executionTime: null,
      };

      const cleaned = cleanTabForStorage(tab);

      expect(cleaned.activeTable).toBeNull();
      expect(cleaned.pkColumns).toBeNull();
      expect(cleaned.query).toBe('');
    });

    it('should preserve flowState for query_builder tabs', () => {
      const flowState = {
        nodes: [{ id: '1', type: 'table', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      };

      const tab: Tab = {
        id: 'tab-123',
        title: 'Visual Query',
        type: 'query_builder',
        query: '',
        page: 1,
        activeTable: null,
        pkColumns: null,
        connectionId: 'conn-456',
        flowState,
        result: null,
        error: '',
        executionTime: null,
      };

      const cleaned = cleanTabForStorage(tab);

      expect(cleaned.flowState).toEqual(flowState);
    });

    it('should preserve notebookId and strip notebookState for notebook tabs', () => {
      const tab: Tab = {
        id: 'tab-nb',
        title: 'Notebook',
        type: 'notebook',
        query: '',
        page: 1,
        activeTable: null,
        pkColumns: null,
        connectionId: 'conn-456',
        result: null,
        error: '',
        executionTime: null,
        notebookId: 'nb_abc123',
        notebookState: {
          cells: [
            {
              id: 'cell-1',
              type: 'sql',
              content: 'SELECT 1',
              result: { columns: ['id'], rows: [[1]], affected_rows: 0 },
              error: 'some error',
              executionTime: 100,
              isLoading: true,
            },
          ],
        },
      };

      const cleaned = cleanTabForStorage(tab);

      expect(cleaned.type).toBe('notebook');
      expect(cleaned.notebookId).toBe('nb_abc123');
      // notebookState should NOT be in the cleaned output
      expect(cleaned).not.toHaveProperty('notebookState');
    });

    it('should handle table type tabs', () => {
      const tab: Tab = {
        id: 'tab-123',
        title: 'users',
        type: 'table',
        query: 'SELECT * FROM users',
        page: 3,
        activeTable: 'users',
        pkColumns: ['id'],
        connectionId: 'conn-456',
        isEditorOpen: false,
        filterClause: 'status = "active"',
        sortClause: 'created_at DESC',
        limitClause: 50,
        result: { columns: [], rows: [], affected_rows: 0 },
        error: '',
        executionTime: null,
      };

      const cleaned = cleanTabForStorage(tab);

      expect(cleaned.type).toBe('table');
      expect(cleaned.activeTable).toBe('users');
      expect(cleaned.isEditorOpen).toBe(false);
      expect(cleaned.filterClause).toBe('status = "active"');
      expect(cleaned.sortClause).toBe('created_at DESC');
      expect(cleaned.limitClause).toBe(50);
    });
  });

  describe('restoreTabFromStorage', () => {
    it('should restore tab with default values for temporary fields', () => {
      const cleanedTab = {
        id: 'tab-123',
        title: 'My Query',
        type: 'console' as const,
        query: 'SELECT * FROM users',
        page: 2,
        activeTable: 'users',
        pkColumns: ['id'],
        connectionId: 'conn-456',
        isEditorOpen: true,
        filterClause: 'age > 18',
      };

      const restored = restoreTabFromStorage(cleanedTab);

      // Should preserve cleaned fields
      expect(restored.id).toBe('tab-123');
      expect(restored.title).toBe('My Query');
      expect(restored.type).toBe('console');
      expect(restored.query).toBe('SELECT * FROM users');
      expect(restored.page).toBe(2);
      expect(restored.activeTable).toBe('users');
      expect(restored.pkColumns).toEqual(['id']);
      expect(restored.connectionId).toBe('conn-456');
      expect(restored.isEditorOpen).toBe(true);
      expect(restored.filterClause).toBe('age > 18');

      // Should add default values for temporary fields
      expect(restored.result).toBeNull();
      expect(restored.error).toBe('');
      expect(restored.executionTime).toBeNull();
      expect(restored.isLoading).toBe(false);
      expect(restored.pendingChanges).toBeUndefined();
      expect(restored.pendingDeletions).toBeUndefined();
      expect(restored.selectedRows).toBeUndefined();
    });

    it('should handle minimal tab data with defaults', () => {
      const minimalTab = {
        id: 'tab-123',
      };

      const restored = restoreTabFromStorage(minimalTab);

      expect(restored.id).toBe('tab-123');
      expect(restored.title).toBe('Untitled');
      expect(restored.type).toBe('console');
      expect(restored.query).toBe('');
      expect(restored.page).toBe(1);
      expect(restored.activeTable).toBeNull();
      expect(restored.pkColumns).toBeNull();
      expect(restored.connectionId).toBe('');
    });

    it('should handle empty object with all defaults', () => {
      const restored = restoreTabFromStorage({});

      expect(restored.id).toBe('');
      expect(restored.title).toBe('Untitled');
      expect(restored.type).toBe('console');
      expect(restored.query).toBe('');
      expect(restored.page).toBe(1);
      expect(restored.activeTable).toBeNull();
      expect(restored.pkColumns).toBeNull();
      expect(restored.connectionId).toBe('');
      expect(restored.result).toBeNull();
      expect(restored.error).toBe('');
      expect(restored.executionTime).toBeNull();
      expect(restored.isLoading).toBe(false);
    });

    it('should preserve all optional persistent fields', () => {
      const cleanedTab = {
        id: 'tab-123',
        title: 'Visual Query',
        type: 'query_builder' as const,
        query: 'SELECT * FROM orders',
        page: 1,
        activeTable: null,
        pkColumns: null,
        connectionId: 'conn-789',
        flowState: {
          nodes: [{ id: '1', type: 'table', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
        },
        isEditorOpen: false,
        sortClause: 'id DESC',
        limitClause: 25,
        queryParams: { startDate: '2024-01-01' },
      };

      const restored = restoreTabFromStorage(cleanedTab);

      expect(restored.flowState).toEqual(cleanedTab.flowState);
      expect(restored.sortClause).toBe('id DESC');
      expect(restored.limitClause).toBe(25);
      expect(restored.queryParams).toEqual({ startDate: '2024-01-01' });
    });

    it('should restore notebook tab with notebookId and no notebookState', () => {
      const cleanedTab = {
        id: 'tab-nb',
        title: 'Notebook',
        type: 'notebook' as const,
        query: '',
        page: 1,
        activeTable: null,
        pkColumns: null,
        connectionId: 'conn-456',
        notebookId: 'nb_abc123',
      };

      const restored = restoreTabFromStorage(cleanedTab);

      expect(restored.type).toBe('notebook');
      expect(restored.notebookId).toBe('nb_abc123');
      expect(restored.notebookState).toBeUndefined();
    });

    it('should handle round-trip for notebook tabs', () => {
      const originalTab: Tab = {
        id: 'tab-nb-rt',
        title: 'Notebook RT',
        type: 'notebook',
        query: '',
        page: 1,
        activeTable: null,
        pkColumns: null,
        connectionId: 'conn-rt',
        result: null,
        error: '',
        executionTime: null,
        notebookId: 'nb_round_trip',
      };

      const cleaned = cleanTabForStorage(originalTab);
      const restored = restoreTabFromStorage(cleaned);

      expect(restored.notebookId).toBe('nb_round_trip');
      expect(restored.notebookState).toBeUndefined();
    });

    it('should handle round-trip: clean then restore', () => {
      const originalTab: Tab = {
        id: 'tab-456',
        title: 'Products',
        type: 'table',
        query: 'SELECT * FROM products WHERE price > 100',
        page: 5,
        activeTable: 'products',
        pkColumns: ['product_id'],
        connectionId: 'conn-999',
        isEditorOpen: true,
        filterClause: 'price > 100',
        sortClause: 'price DESC',
        limitClause: 20,
        // Temporary data that will be lost
        result: { columns: ['id', 'name'], rows: [], affected_rows: 0 },
        error: 'Connection timeout',
        executionTime: 456,
        isLoading: false,
        selectedRows: [1, 2],
      };

      const cleaned = cleanTabForStorage(originalTab);
      const restored = restoreTabFromStorage(cleaned);

      // Persistent fields should match
      expect(restored.id).toBe(originalTab.id);
      expect(restored.title).toBe(originalTab.title);
      expect(restored.type).toBe(originalTab.type);
      expect(restored.query).toBe(originalTab.query);
      expect(restored.page).toBe(originalTab.page);
      expect(restored.activeTable).toBe(originalTab.activeTable);
      expect(restored.pkColumns).toEqual(originalTab.pkColumns);
      expect(restored.connectionId).toBe(originalTab.connectionId);
      expect(restored.isEditorOpen).toBe(originalTab.isEditorOpen);
      expect(restored.filterClause).toBe(originalTab.filterClause);
      expect(restored.sortClause).toBe(originalTab.sortClause);
      expect(restored.limitClause).toBe(originalTab.limitClause);

      // Temporary fields should be reset
      expect(restored.result).toBeNull();
      expect(restored.error).toBe('');
      expect(restored.executionTime).toBeNull();
      expect(restored.isLoading).toBe(false);
      expect(restored.selectedRows).toBeUndefined();
    });
  });
});
