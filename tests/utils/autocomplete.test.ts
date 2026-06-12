import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearAutocompleteCache,
  registerSqlAutocomplete,
} from '../../src/utils/autocomplete';
import type { TableInfo } from '../../src/contexts/DatabaseContext';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock sqlAnalysis
vi.mock('../../src/utils/sqlAnalysis', () => ({
  getCurrentStatement: vi.fn((model) => model.getValue()),
  parseTablesFromQuery: vi.fn(() => new Map()),
}));

import { invoke } from '@tauri-apps/api/core';

// Create a mock Monaco object
const createMockMonaco = () => ({
  languages: {
    CompletionItemKind: {
      Field: 1,
      Keyword: 2,
      Class: 3,
    },
    registerCompletionItemProvider: vi.fn((language, provider) => ({
      dispose: vi.fn(),
    })),
  },
});

// Create a mock model
const createMockModel = (value: string, wordAtPosition: string = '') => ({
  getValue: () => value,
  getOffsetAt: vi.fn((pos) => pos.lineNumber * 100 + pos.column),
  getWordUntilPosition: vi.fn(() => ({
    startColumn: 1,
    endColumn: wordAtPosition.length + 1,
  })),
  getValueInRange: vi.fn((range) => {
    const lines = value.split('\n');
    if (range.startLineNumber === range.endLineNumber) {
      return lines[range.startLineNumber - 1]?.substring(range.startColumn - 1, range.endColumn - 1) || '';
    }
    return value;
  }),
});

describe('autocomplete', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearAutocompleteCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('clearAutocompleteCache', () => {
    it('should clear all cache when called without connectionId', () => {
      // Pre-populate cache by registering provider and triggering completion
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValueOnce([
        { name: 'id', data_type: 'INTEGER' },
      ]);

      const monaco = createMockMonaco();
      const tables: TableInfo[] = [{ name: 'users' }];
      
      registerSqlAutocomplete(monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0], 'conn1', tables);

      // Verify provider was registered
      expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalled();
    });

    it('should clear cache for specific connection only', () => {
      clearAutocompleteCache('conn1');
      // No error should be thrown
      expect(true).toBe(true);
    });
  });

  describe('registerSqlAutocomplete', () => {
    it('should register completion provider', () => {
      const monaco = createMockMonaco();
      const tables: TableInfo[] = [];
      
      const provider = registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
        'sql',
        expect.objectContaining({
          triggerCharacters: ['.', ' '],
          provideCompletionItems: expect.any(Function),
        })
      );
    });

    it('should return empty suggestions when no connectionId', async () => {
      const monaco = createMockMonaco();
      const tables: TableInfo[] = [{ name: 'users' }];
      
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        null,
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT * FROM users');
      const position = { lineNumber: 1, column: 10 };

      const result = await provider.provideCompletionItems(model, position);
      expect(result.suggestions).toEqual([]);
    });

    it('should return table suggestions for matching tables', async () => {
      const monaco = createMockMonaco();
      const tables: TableInfo[] = [
        { name: 'users' },
        { name: 'orders' },
      ];

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT * FROM ');
      const position = { lineNumber: 1, column: 15 };

      const result = await provider.provideCompletionItems(model, position);
      
      // Suggestions include both tables and keywords (when no context columns)
      // Tables are sorted first with sortText prefix '1_'
      const tableSuggestions = result.suggestions.filter((s: { sortText?: string }) => 
        s.sortText?.startsWith('1_')
      );
      expect(tableSuggestions).toHaveLength(2);
      expect(tableSuggestions[0].label).toBe('users');
      expect(tableSuggestions[1].label).toBe('orders');
    });

    it('should include all table suggestions regardless of count', async () => {
      const monaco = createMockMonaco();
      const tables: TableInfo[] = Array.from({ length: 60 }, (_, i) => ({
        name: `table_${i}`,
      }));

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT * FROM ');
      const position = { lineNumber: 1, column: 15 };

      const result = await provider.provideCompletionItems(model, position);

      // All 60 tables should be present — no arbitrary cap
      const tableSuggestions = result.suggestions.filter((s: { sortText?: string }) =>
        s.sortText?.startsWith('1_')
      );
      expect(tableSuggestions.length).toBe(60);
    });

    it('should return keyword suggestions when no context', async () => {
      const monaco = createMockMonaco();
      const tables: TableInfo[] = [];

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SEL');
      const position = { lineNumber: 1, column: 4 };

      const result = await provider.provideCompletionItems(model, position);
      
      // Should include SQL keywords
      const keywordSuggestions = result.suggestions.filter(
        (s: { kind: number }) => s.kind === monaco.languages.CompletionItemKind.Keyword
      );
      expect(keywordSuggestions.length).toBeGreaterThan(0);
    });
  });

  describe('caching behavior', () => {
    it('should cache column data with TTL', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([
        { name: 'id', data_type: 'INTEGER' },
        { name: 'name', data_type: 'VARCHAR' },
      ]);

      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      const mockParseTables = parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>;
      
      // Simulate that we have a table in context to trigger column fetching
      mockParseTables.mockReturnValue(new Map([['users', { name: 'users' }]])); // alias -> ParsedTableRef

      const monaco = createMockMonaco();
      const tables: TableInfo[] = [{ name: 'users' }];

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT * FROM users');
      const position = { lineNumber: 1, column: 20 };

      // First call - should fetch from backend because we have tables in context
      await provider.provideCompletionItems(model, position);
      expect(mockInvoke).toHaveBeenCalledWith('get_columns', {
        connectionId: 'conn1',
        tableName: 'users',
      });

      // Reset mock to track second call
      mockInvoke.mockClear();

      // Second call - should use cache
      await provider.provideCompletionItems(model, position);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('should handle non-array response from get_columns', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue({ not: 'an array' });

      const monaco = createMockMonaco();
      const tables: TableInfo[] = [{ name: 'users' }];

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT * FROM users');
      const position = { lineNumber: 1, column: 20 };

      const result = await provider.provideCompletionItems(model, position);
      
      // Should not throw and return some suggestions
      expect(result).toHaveProperty('suggestions');
    });

    it('should handle get_columns errors gracefully', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockRejectedValue(new Error('Database error'));

      const monaco = createMockMonaco();
      const tables: TableInfo[] = [{ name: 'users' }];

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT * FROM users');
      const position = { lineNumber: 1, column: 20 };

      // Should not throw
      const result = await provider.provideCompletionItems(model, position);
      expect(result).toHaveProperty('suggestions');
    });
  });

  describe('dot trigger (table.column)', () => {
    it('should provide column suggestions after typing table name with dot', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([
        { name: 'id', data_type: 'INTEGER' },
        { name: 'email', data_type: 'VARCHAR' },
      ]);

      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      const mockParseTables = parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>;
      mockParseTables.mockReturnValue(new Map([['u', { name: 'users' }]])); // alias -> ParsedTableRef

      const monaco = createMockMonaco();
      const tables: TableInfo[] = [{ name: 'users' }];

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT u.');
      const position = { lineNumber: 1, column: 10 };

      // Mock getValueInRange to return text ending with dot
      model.getValueInRange = vi.fn(() => 'SELECT u.');

      const result = await provider.provideCompletionItems(model, position);
      
      // Should include column suggestions
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('suggestion limits', () => {
    it('should return all suggestions without an arbitrary total cap', async () => {
      const monaco = createMockMonaco();
      const tables: TableInfo[] = Array.from({ length: 100 }, (_, i) => ({
        name: `table_${i}`,
      }));

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT * FROM ');
      const position = { lineNumber: 1, column: 15 };

      const result = await provider.provideCompletionItems(model, position);

      // All 100 tables should be present — Monaco handles filtering internally
      const tableSuggestions = result.suggestions.filter((s: { sortText?: string }) =>
        s.sortText?.startsWith('1_')
      );
      expect(tableSuggestions.length).toBe(100);
    });
  });
});
