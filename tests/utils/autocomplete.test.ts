import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  applyKeywordCase,
  clearAutocompleteCache,
  needsKeywordCaseRetrigger,
  registerSqlAutocomplete,
  resolveKeywordCase,
  type AutocompleteKeywordCase,
} from '../../src/utils/autocomplete';
import type { TableInfo } from '../../src/contexts/DatabaseContext';
import type { PluginManifest } from '../../src/types/plugins';

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
    word: wordAtPosition,
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

    it('inserts double-quoted table names for postgres', async () => {
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'AccountEventLog' }],
        null,
        'postgres',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const result = await provider.provideCompletionItems(
        createMockModel('SELECT * FROM '),
        { lineNumber: 1, column: 15 },
      );

      const tableSuggestions = result.suggestions.filter((s: { sortText?: string }) =>
        s.sortText?.startsWith('1_'),
      );
      expect(tableSuggestions[0]?.insertText).toBe('"AccountEventLog"');
    });

    it('inserts double-quoted table names for a postgres-dialect plugin manifest, same as the bare "postgres" string (issue #614)', async () => {
      const pluginManifest: PluginManifest = {
        id: 'postgresql',
        name: 'PostgreSQL',
        version: '1.0.0',
        description: '',
        default_port: 5432,
        capabilities: {
          schemas: true, views: true, routines: true,
          file_based: false, folder_based: false,
          identifier_quote: '"', alter_primary_key: true,
          sql_dialect: 'postgres',
        },
      };
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'AccountEventLog' }],
        null,
        pluginManifest,
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const result = await provider.provideCompletionItems(
        createMockModel('SELECT * FROM '),
        { lineNumber: 1, column: 15 },
      );

      const tableSuggestions = result.suggestions.filter((s: { sortText?: string }) =>
        s.sortText?.startsWith('1_'),
      );
      expect(tableSuggestions[0]?.insertText).toBe('"AccountEventLog"');
    });

    it('does not prefix schema and quotes table name only if needed for postgres', async () => {
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'AccountEventLog' }],
        'public',
        'postgres',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const result = await provider.provideCompletionItems(
        createMockModel('SELECT * FROM '),
        { lineNumber: 1, column: 15 },
      );

      const tableSuggestions = result.suggestions.filter((s: { sortText?: string }) =>
        s.sortText?.startsWith('1_'),
      );
      expect(tableSuggestions[0]?.insertText).toBe('"AccountEventLog"');
    });

    it('swallows the auto-closed quote pair when an opening quote was typed (postgres)', async () => {
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'AccountEventLog' }],
        null,
        'postgres',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      // `SELECT * FROM ""` — Monaco auto-closed the quote, cursor between the pair.
      const model = createMockModel('SELECT * FROM ""');
      model.getWordUntilPosition = vi.fn(() => ({ startColumn: 16, endColumn: 16 }));

      const result = await provider.provideCompletionItems(model, {
        lineNumber: 1,
        column: 16,
      });

      const table = result.suggestions.find((s: { sortText?: string }) =>
        s.sortText?.startsWith('1_'),
      );
      // Canonical quoted identifier, range swallows BOTH surrounding quotes so
      // the result is exactly "AccountEventLog" (not ""AccountEventLog"").
      expect(table?.insertText).toBe('"AccountEventLog"');
      expect(table?.range.startColumn).toBe(15);
      expect(table?.range.endColumn).toBe(17);
      // Range starts at the opening quote, so filterText must also be quoted or
      // Monaco filters every suggestion out.
      expect(table?.filterText).toBe('"AccountEventLog"');
    });

    it('still closes the identifier when the auto-closed quote was deleted (postgres)', async () => {
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'AccountEventLog' }],
        null,
        'postgres',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      // `SELECT * FROM "` — user deleted the auto-closed quote, only the opening one remains.
      const model = createMockModel('SELECT * FROM "');
      model.getWordUntilPosition = vi.fn(() => ({ startColumn: 16, endColumn: 16 }));

      const result = await provider.provideCompletionItems(model, {
        lineNumber: 1,
        column: 16,
      });

      const table = result.suggestions.find((s: { sortText?: string }) =>
        s.sortText?.startsWith('1_'),
      );
      // Full quoted identifier replaces the lone opening quote → "AccountEventLog".
      expect(table?.insertText).toBe('"AccountEventLog"');
      expect(table?.range.startColumn).toBe(15);
      expect(table?.range.endColumn).toBe(16);
      expect(table?.filterText).toBe('"AccountEventLog"');
    });

    it('does not quote plain lowercase table names for postgres', async () => {
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'users' }],
        null,
        'postgres',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const result = await provider.provideCompletionItems(
        createMockModel('SELECT * FROM '),
        { lineNumber: 1, column: 15 },
      );

      const tableSuggestions = result.suggestions.filter((s: { sortText?: string }) =>
        s.sortText?.startsWith('1_'),
      );
      expect(tableSuggestions[0]?.insertText).toBe('users');
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
      // Cursor sits in the WHERE clause, a column-suggesting context
      const model = createMockModel('SELECT * FROM users WHERE ');
      const position = { lineNumber: 1, column: 27 };

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
    it('should suggest tables after an active database qualifier', async () => {
      const monaco = createMockMonaco();
      const tables: TableInfo[] = [
        { name: 'Addresses', schema: 'Ops' },
        { name: 'AuditLog', schema: 'Ops' },
        { name: 'Addresses', schema: 'Archive' },
      ];

      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables,
        'Ops',
        'mysql',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const value = 'SELECT * FROM Ops.';
      const result = await provider.provideCompletionItems(
        createMockModel(value),
        { lineNumber: 1, column: value.length + 1 },
      );

      expect(result.suggestions.map((suggestion: { label: string }) => suggestion.label))
        .toEqual(['Addresses', 'AuditLog']);
      expect(result.suggestions[0]?.insertText).toBe('Addresses');
      expect(result.suggestions[0]?.detail).toBe('Table · Ops');
      expect(invoke).not.toHaveBeenCalled();
    });

    it('should replace only the partial table name after a database qualifier', async () => {
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'Addresses', schema: 'Ops' }],
        'Ops',
        'mysql',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const value = 'SELECT * FROM Ops.Add';
      const result = await provider.provideCompletionItems(
        createMockModel(value, 'Add'),
        { lineNumber: 1, column: value.length + 1 },
      );

      expect(result.suggestions[0]?.label).toBe('Addresses');
      expect(result.suggestions[0]?.range.startColumn).toBe(value.length - 2);
      expect(result.suggestions[0]?.range.endColumn).toBe(value.length + 1);
      expect(invoke).not.toHaveBeenCalled();
    });

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

    it('inserts double-quoted column names for postgres', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([{ name: 'CreatedAt', data_type: 'timestamp' }]);

      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      (parseTablesFromQuery as ReturnType<typeof vi.fn>).mockReturnValue(
        new Map([['ael', { name: 'AccountEventLog' }]]),
      );

      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'AccountEventLog' }],
        'public',
        'postgres',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT ael.');
      model.getValueInRange = vi.fn(() => 'SELECT ael.');

      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 12 });

      expect(result.suggestions[0]?.insertText).toBe('"CreatedAt"');
    });

    it('does not quote plain lowercase column names for postgres', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([{ name: 'email', data_type: 'varchar' }]);

      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      (parseTablesFromQuery as ReturnType<typeof vi.fn>).mockReturnValue(
        new Map([['u', { name: 'users' }]]),
      );

      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        [{ name: 'users' }],
        'public',
        'postgres',
      );

      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const model = createMockModel('SELECT u.');
      model.getValueInRange = vi.fn(() => 'SELECT u.');

      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 10 });

      expect(result.suggestions[0]?.insertText).toBe('email');
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

  describe('clause-aware gating', () => {
    const setup = (tables: TableInfo[] = [{ name: 'users' }]) => {
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        tables
      );
      return monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
    };

    // Suggestion groups are distinguished by their sortText prefix:
    // '0_' columns, '1_' tables, '2_' keywords.
    const groupsOf = (suggestions: Array<{ sortText?: string }>) => ({
      columns: suggestions.filter((s) => s.sortText?.startsWith('0_')).length,
      tables: suggestions.filter((s) => s.sortText?.startsWith('1_')).length,
      keywords: suggestions.filter((s) => s.sortText?.startsWith('2_')).length,
    });

    it('returns no suggestions inside a string literal', async () => {
      const provider = setup();
      const model = createMockModel("SELECT * FROM users WHERE name = 'jo");
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 38 });
      expect(result.suggestions).toHaveLength(0);
    });

    it('returns no suggestions inside a comment', async () => {
      const provider = setup();
      const model = createMockModel('SELECT 1 -- fetch users');
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 24 });
      expect(result.suggestions).toHaveLength(0);
    });

    it('suggests tables but no columns after FROM', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([{ name: 'id', data_type: 'INTEGER' }]);
      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      (parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>)
        .mockReturnValue(new Map([['users', { name: 'users' }]]));

      const provider = setup();
      const model = createMockModel('SELECT * FROM ');
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 15 });

      const groups = groupsOf(result.suggestions);
      expect(groups.tables).toBeGreaterThan(0);
      expect(groups.columns).toBe(0);
      expect(mockInvoke).not.toHaveBeenCalledWith('get_columns', expect.anything());
    });

    it('suggests columns but no tables after WHERE', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([{ name: 'id', data_type: 'INTEGER' }]);
      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      (parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>)
        .mockReturnValue(new Map([['users', { name: 'users' }]]));

      const provider = setup();
      const model = createMockModel('SELECT * FROM users WHERE ');
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 27 });

      const groups = groupsOf(result.suggestions);
      expect(groups.columns).toBeGreaterThan(0);
      expect(groups.tables).toBe(0);
      expect(groups.keywords).toBeGreaterThan(0);
    });

    it('suggests only columns inside an INSERT column list', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([
        { name: 'customer_id', data_type: 'INT' },
        { name: 'total', data_type: 'DECIMAL' },
      ]);
      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      (parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>)
        .mockReturnValue(new Map([['orders', { name: 'orders' }]]));

      const provider = setup([{ name: 'orders' }]);
      const model = createMockModel('INSERT INTO orders (');
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 21 });

      const groups = groupsOf(result.suggestions);
      expect(groups.columns).toBe(2);
      expect(groups.tables).toBe(0);
      expect(groups.keywords).toBe(0);
    });

    it('resolves context columns from the innermost subquery scope only', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([{ name: 'session_id', data_type: 'INT' }]);
      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      const mockParse = parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>;
      // The scoped slice contains only the subquery; the full statement both tables.
      mockParse.mockImplementation((sql: string) =>
        sql.startsWith('SELECT session_id')
          ? new Map([['page_views', { name: 'page_views' }]])
          : new Map([
              ['sessions', { name: 'sessions' }],
              ['page_views', { name: 'page_views' }],
            ])
      );

      const value = 'SELECT * FROM sessions WHERE id IN (SELECT session_id FROM page_views WHERE ';
      const provider = setup([{ name: 'sessions' }, { name: 'page_views' }]);
      const model = createMockModel(value);
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: value.length + 1 });

      // The scoped parse received exactly the subquery text...
      expect(mockParse).toHaveBeenCalledWith('SELECT session_id FROM page_views WHERE ');
      // ...and columns were fetched for the subquery's table only.
      expect(mockInvoke).toHaveBeenCalledWith('get_columns', expect.objectContaining({ tableName: 'page_views' }));
      expect(mockInvoke).not.toHaveBeenCalledWith('get_columns', expect.objectContaining({ tableName: 'sessions' }));
      expect(groupsOf(result.suggestions).columns).toBeGreaterThan(0);
    });

    it('still resolves outer aliases via dot trigger inside a subquery (correlated)', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockResolvedValue([{ name: 'id', data_type: 'INT' }]);
      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      const mockParse = parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>;
      mockParse.mockImplementation((sql: string) =>
        sql.startsWith('SELECT 1')
          ? new Map([['p', { name: 'page_views' }]])
          : new Map([
              ['s', { name: 'sessions' }],
              ['p', { name: 'page_views' }],
            ])
      );

      const value = 'SELECT * FROM sessions s WHERE EXISTS (SELECT 1 FROM page_views p WHERE p.session_id = s.';
      const provider = setup([{ name: 'sessions' }, { name: 'page_views' }]);
      const model = createMockModel(value);
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: value.length + 1 });

      // `s.` is not in the subquery scope, but the merged alias map resolves it.
      expect(mockInvoke).toHaveBeenCalledWith('get_columns', expect.objectContaining({ tableName: 'sessions' }));
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('ranks WHERE above WHEN after FROM (keyword relevance)', async () => {
      const provider = setup();
      const model = createMockModel('SELECT * FROM users ');
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 21 });

      const labels = result.suggestions.map((s: { label: string }) => s.label);
      expect(labels).not.toContain('WHEN'); // CASE-only keyword is hidden here
      const where = result.suggestions.find((s: { label: string }) => s.label === 'WHERE');
      const notBoosted = result.suggestions.find((s: { label: string }) => s.label === 'SELECT');
      expect(where?.sortText).toBe('2_0_WHERE');
      expect(notBoosted?.sortText).toBe('2_1_SELECT');
    });

    it('ranks columns of the nearest table above other tables in scope', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      mockInvoke.mockImplementation(async (cmd, args: { tableName: string }) => {
        if (args.tableName === 'customers') {
          return [{ name: 'customer_name', data_type: 'VARCHAR' }];
        }
        if (args.tableName === 'orders') {
          return [{ name: 'order_total', data_type: 'INT' }];
        }
        return [];
      });

      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      (parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        new Map([
          ['o', { name: 'orders' }],
          ['c', { name: 'customers' }],
        ]),
      );

      const provider = setup([{ name: 'orders' }, { name: 'customers' }]);
      // In ON clause, the joined table `customers c` is nearest
      const onQuery = 'SELECT * FROM orders o JOIN customers c ON ';
      const modelOn = createMockModel(onQuery);
      const resultOn = await provider.provideCompletionItems(modelOn, { lineNumber: 1, column: onQuery.length + 1 });

      const custColOn = resultOn.suggestions.find((s: { label: string }) => s.label === 'customer_name');
      const orderColOn = resultOn.suggestions.find((s: { label: string }) => s.label === 'order_total');
      expect(custColOn?.sortText).toBe('0_0_customer_name');
      expect(orderColOn?.sortText).toBe('0_1_order_total');

      // In WHERE clause, the primary FROM table `orders o` is nearest
      const whereQuery = 'SELECT * FROM orders o JOIN customers c ON o.cust_id = c.id WHERE ';
      const modelWhere = createMockModel(whereQuery);
      const resultWhere = await provider.provideCompletionItems(modelWhere, { lineNumber: 1, column: whereQuery.length + 1 });

      const orderColWhere = resultWhere.suggestions.find((s: { label: string }) => s.label === 'order_total');
      const custColWhere = resultWhere.suggestions.find((s: { label: string }) => s.label === 'customer_name');
      expect(orderColWhere?.sortText).toBe('0_0_order_total');
      expect(custColWhere?.sortText).toBe('0_1_customer_name');
    });

    it('suggests only keywords on an empty buffer', async () => {
      const provider = setup();
      const model = createMockModel('');
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 1 });

      const groups = groupsOf(result.suggestions);
      expect(groups.keywords).toBeGreaterThan(0);
      expect(groups.tables).toBe(0);
      expect(groups.columns).toBe(0);
    });

    it('gives shared column names the nearest table prefix over non-nearest tables', async () => {
      const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
      // Both orders and customers share an `id` column.
      mockInvoke.mockImplementation(async (_cmd: string, args: { tableName: string }) => {
        if (args.tableName === 'customers') {
          return [
            { name: 'id', data_type: 'INT' },
            { name: 'customer_name', data_type: 'VARCHAR' },
          ];
        }
        if (args.tableName === 'orders') {
          return [
            { name: 'id', data_type: 'INT' },
            { name: 'order_total', data_type: 'INT' },
          ];
        }
        return [];
      });

      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      (parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        new Map([
          ['o', { name: 'orders' }],
          ['c', { name: 'customers' }],
        ]),
      );

      const provider = setup([{ name: 'orders' }, { name: 'customers' }]);
      // In ON, the joined table `customers c` is nearest, but `orders o` comes
      // first in alias insertion order: without nearest-first ordering the
      // shared `id` label would be claimed by orders.
      const onQuery = 'SELECT * FROM orders o JOIN customers c ON ';
      const modelOn = createMockModel(onQuery);
      const resultOn = await provider.provideCompletionItems(
        modelOn,
        { lineNumber: 1, column: onQuery.length + 1 },
      );

      const idSuggestions = resultOn.suggestions.filter((s: { label: string }) => s.label === 'id');
      // Deduplicated to a single `id`, attributed to the nearest table.
      expect(idSuggestions).toHaveLength(1);
      expect(idSuggestions[0].sortText).toBe('0_0_id');
      expect(idSuggestions[0].detail).toContain('customers');
    });
  });

  describe('keyword case helpers', () => {
    describe('resolveKeywordCase', () => {
      describe('match mode', () => {
        it('should resolve lowercase input to lower', () => {
          expect(resolveKeywordCase('match', 'sel')).toBe('lower');
        });

        it('should resolve uppercase input to upper', () => {
          expect(resolveKeywordCase('match', 'SEL')).toBe('upper');
        });

        it('should resolve a single lowercase character to lower', () => {
          expect(resolveKeywordCase('match', 's')).toBe('lower');
        });

        it('should fall back to upper for mixed case input', () => {
          expect(resolveKeywordCase('match', 'Sel')).toBe('upper');
          expect(resolveKeywordCase('match', 'sEL')).toBe('upper');
        });

        it('should fall back to upper for empty input', () => {
          expect(resolveKeywordCase('match', '')).toBe('upper');
        });

        it('should fall back to upper when the input has no letters', () => {
          expect(resolveKeywordCase('match', '_1')).toBe('upper');
        });

        it('should ignore non-letter characters when deciding', () => {
          expect(resolveKeywordCase('match', '_se1')).toBe('lower');
          expect(resolveKeywordCase('match', '_SE1')).toBe('upper');
        });

        it('should treat an undefined mode as match', () => {
          expect(resolveKeywordCase(undefined, 'sel')).toBe('lower');
          expect(resolveKeywordCase(undefined, 'SEL')).toBe('upper');
        });
      });

      describe('forced modes', () => {
        it('should always resolve to upper in upper mode', () => {
          expect(resolveKeywordCase('upper', 'sel')).toBe('upper');
          expect(resolveKeywordCase('upper', '')).toBe('upper');
        });

        it('should always resolve to lower in lower mode', () => {
          expect(resolveKeywordCase('lower', 'SEL')).toBe('lower');
          expect(resolveKeywordCase('lower', '')).toBe('lower');
        });
      });
    });

    describe('needsKeywordCaseRetrigger', () => {
      it('should ask again in match mode while no letter has been typed', () => {
        expect(needsKeywordCaseRetrigger('match', '')).toBe(true);
        expect(needsKeywordCaseRetrigger('match', '_1')).toBe(true);
      });

      it('should not ask again once the prefix has a letter', () => {
        expect(needsKeywordCaseRetrigger('match', 'w')).toBe(false);
        expect(needsKeywordCaseRetrigger('match', 'WH')).toBe(false);
        expect(needsKeywordCaseRetrigger('match', '_w')).toBe(false);
      });

      it('should treat an undefined mode as match', () => {
        expect(needsKeywordCaseRetrigger(undefined, '')).toBe(true);
      });

      it('should never ask again in forced modes', () => {
        expect(needsKeywordCaseRetrigger('upper', '')).toBe(false);
        expect(needsKeywordCaseRetrigger('lower', '')).toBe(false);
      });
    });

    describe('applyKeywordCase', () => {
      it('should lowercase the keyword when typing lowercase in match mode', () => {
        expect(applyKeywordCase('SELECT', 'match', 'sel')).toBe('select');
      });

      it('should uppercase the keyword when typing uppercase in match mode', () => {
        expect(applyKeywordCase('SELECT', 'match', 'SEL')).toBe('SELECT');
      });

      it('should uppercase the keyword for ambiguous input in match mode', () => {
        expect(applyKeywordCase('SELECT', 'match', '')).toBe('SELECT');
        expect(applyKeywordCase('SELECT', 'match', 'Sel')).toBe('SELECT');
      });

      it('should force upper regardless of input', () => {
        expect(applyKeywordCase('select', 'upper', 'sel')).toBe('SELECT');
      });

      it('should force lower regardless of input', () => {
        expect(applyKeywordCase('SELECT', 'lower', 'SEL')).toBe('select');
      });

      it('should case multi-word keywords as a whole', () => {
        expect(applyKeywordCase('ORDER BY', 'match', 'ord')).toBe('order by');
        expect(applyKeywordCase('order by', 'match', 'ORD')).toBe('ORDER BY');
      });

      it('should be idempotent', () => {
        const once = applyKeywordCase('GROUP BY', 'lower', '');
        expect(applyKeywordCase(once, 'lower', '')).toBe(once);
      });
    });
  });

  describe('keyword case setting', () => {
    type Suggestion = {
      label: string;
      kind: number;
      insertText: string;
      sortText?: string;
    };

    // Same buffer as the 'ranks WHERE above WHEN' test: WHERE is boosted
    // ('2_0_WHERE'), WHEN is hidden, SELECT is a plain keyword ('2_1_SELECT').
    const BUFFER = 'SELECT * FROM users ';

    beforeEach(async () => {
      // Earlier tests leave mockReturnValue / mockResolvedValue behind; start
      // from "no tables in scope, no columns" so only keywords come back.
      const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
      (parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Map());
      (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    });

    const complete = async (opts: {
      value?: string;
      word?: string;
      keywordCase?: AutocompleteKeywordCase;
      tables?: TableInfo[];
    }) => {
      const value = opts.value ?? BUFFER;
      const monaco = createMockMonaco();
      registerSqlAutocomplete(
        monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
        'conn1',
        opts.tables ?? [],
        null,
        undefined,
        opts.keywordCase,
      );
      const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
      const result = await provider.provideCompletionItems(
        createMockModel(value, opts.word ?? ''),
        { lineNumber: 1, column: value.length + 1 },
      );
      const suggestions = result.suggestions as Suggestion[];
      const keywordKind = monaco.languages.CompletionItemKind.Keyword;
      return {
        keywords: suggestions.filter((s) => s.kind === keywordKind),
        others: suggestions.filter((s) => s.kind !== keywordKind),
        incomplete: result.incomplete as boolean | undefined,
      };
    };

    const labelsOf = (suggestions: Suggestion[]) => suggestions.map((s) => s.label);

    describe('match mode', () => {
      it('should insert lowercase keywords when the typed prefix is lowercase', async () => {
        const { keywords } = await complete({ keywordCase: 'match', word: 'wh' });

        const where = keywords.find((k) => k.label === 'where');
        expect(where?.insertText).toBe('where');
        expect(labelsOf(keywords)).not.toContain('WHERE');
        expect(keywords.every((k) => k.label === k.label.toLowerCase())).toBe(true);
        expect(keywords.every((k) => k.insertText === k.label)).toBe(true);
      });

      it('should insert uppercase keywords when the typed prefix is uppercase', async () => {
        const { keywords } = await complete({ keywordCase: 'match', word: 'WH' });

        const where = keywords.find((k) => k.label === 'WHERE');
        expect(where?.insertText).toBe('WHERE');
        expect(keywords.every((k) => k.label === k.label.toUpperCase())).toBe(true);
      });

      it('should fall back to uppercase for a mixed-case prefix', async () => {
        const { keywords } = await complete({ keywordCase: 'match', word: 'Wh' });

        expect(labelsOf(keywords)).toContain('WHERE');
        expect(keywords.every((k) => k.label === k.label.toUpperCase())).toBe(true);
      });

      it('should fall back to uppercase when nothing has been typed yet', async () => {
        const { keywords } = await complete({ keywordCase: 'match', word: '' });

        expect(labelsOf(keywords)).toContain('WHERE');
        expect(keywords.every((k) => k.label === k.label.toUpperCase())).toBe(true);
      });

      it('should be the default when no keyword case is passed', async () => {
        const lower = await complete({ word: 'wh' });
        const upper = await complete({ word: 'WH' });

        expect(labelsOf(lower.keywords)).toContain('where');
        expect(labelsOf(upper.keywords)).toContain('WHERE');
      });
    });

    describe('forced modes', () => {
      it('should force uppercase regardless of the typed prefix', async () => {
        const { keywords } = await complete({ keywordCase: 'upper', word: 'wh' });

        expect(labelsOf(keywords)).toContain('WHERE');
        expect(keywords.every((k) => k.insertText === k.insertText.toUpperCase())).toBe(true);
      });

      it('should force lowercase regardless of the typed prefix', async () => {
        const { keywords } = await complete({ keywordCase: 'lower', word: 'WH' });

        expect(labelsOf(keywords)).toContain('where');
        expect(keywords.every((k) => k.insertText === k.insertText.toLowerCase())).toBe(true);
      });

      it('should force lowercase even when nothing has been typed', async () => {
        const { keywords } = await complete({ keywordCase: 'lower', word: '' });

        expect(keywords.length).toBeGreaterThan(0);
        expect(keywords.every((k) => k.label === k.label.toLowerCase())).toBe(true);
      });
    });

    describe('re-query while typing (match mode)', () => {
      it('should mark the result incomplete when the list opens with no letters typed', async () => {
        const { keywords, incomplete } = await complete({ keywordCase: 'match', word: '' });

        expect(keywords.length).toBeGreaterThan(0);
        expect(incomplete).toBe(true);
      });

      it('should not mark the result incomplete once a letter has been typed', async () => {
        const lower = await complete({ keywordCase: 'match', word: 'w' });
        const upper = await complete({ keywordCase: 'match', word: 'W' });

        expect(lower.incomplete).toBeUndefined();
        expect(upper.incomplete).toBeUndefined();
      });

      it('should not mark the result incomplete in forced modes', async () => {
        const upper = await complete({ keywordCase: 'upper', word: '' });
        const lower = await complete({ keywordCase: 'lower', word: '' });

        expect(upper.incomplete).toBeUndefined();
        expect(lower.incomplete).toBeUndefined();
      });

      it('should not mark the result incomplete when no keywords are offered', async () => {
        const { keywords, incomplete } = await complete({
          value: 'SELECT * FROM users',
          keywordCase: 'match',
          word: '',
        });

        // Mid-identifier buffers may or may not offer keywords; the flag must
        // only be set when there are keywords whose case could still change.
        expect(incomplete === true).toBe(keywords.length > 0);
      });

      it('should follow lowercase typing after the list was opened by a space', async () => {
        // Simulates Monaco: the list opens on " " (empty word), then the user
        // types "wh" and Monaco re-queries because the first result was incomplete.
        const opened = await complete({ keywordCase: 'match', word: '' });
        expect(opened.incomplete).toBe(true);
        expect(labelsOf(opened.keywords)).toContain('WHERE');

        const requeried = await complete({ keywordCase: 'match', word: 'w' });
        expect(labelsOf(requeried.keywords)).toContain('where');
        expect(labelsOf(requeried.keywords)).not.toContain('WHERE');
        expect(requeried.incomplete).toBeUndefined();
      });

      it('should keep uppercase typing uppercase after the re-query', async () => {
        const requeried = await complete({ keywordCase: 'match', word: 'W' });

        expect(labelsOf(requeried.keywords)).toContain('WHERE');
      });
    });

    describe('keyword set and ranking', () => {
      it('should offer the same keywords whatever the case', async () => {
        const upper = await complete({ keywordCase: 'upper' });
        const lower = await complete({ keywordCase: 'lower' });

        expect(labelsOf(lower.keywords)).toEqual(
          labelsOf(upper.keywords).map((l) => l.toLowerCase()),
        );
      });

      it('should keep ranking independent of the keyword case', async () => {
        const upper = await complete({ keywordCase: 'upper' });
        const lower = await complete({ keywordCase: 'lower' });

        expect(lower.keywords.map((k) => k.sortText)).toEqual(
          upper.keywords.map((k) => k.sortText),
        );
        const where = lower.keywords.find((k) => k.label === 'where');
        const select = lower.keywords.find((k) => k.label === 'select');
        expect(where?.sortText).toBe('2_0_WHERE');
        expect(select?.sortText).toBe('2_1_SELECT');
      });

      it('should still hide keywords that are irrelevant in the clause', async () => {
        const { keywords } = await complete({ keywordCase: 'lower', word: 'wh' });

        expect(labelsOf(keywords)).not.toContain('when');
      });
    });

    describe('identifiers are never re-cased', () => {
      const modes: AutocompleteKeywordCase[] = ['match', 'upper', 'lower'];

      it.each(modes)('should keep table names as-is in %s mode', async (keywordCase) => {
        const { others } = await complete({
          value: 'SELECT * FROM ',
          word: 'us',
          keywordCase,
          tables: [{ name: 'Users' }, { name: 'ORDERS' }, { name: 'order_items' }],
        });

        expect(labelsOf(others)).toEqual(['Users', 'ORDERS', 'order_items']);
        expect(others[0].insertText).toContain('Users');
        expect(others[1].insertText).toContain('ORDERS');
        expect(others[2].insertText).toContain('order_items');
      });

      it.each(modes)('should keep column names as-is in %s mode', async (keywordCase) => {
        const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
        (parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
          new Map([['users', { name: 'users' }]]),
        );
        (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
          { name: 'CreatedAt', data_type: 'timestamp' },
          { name: 'EMAIL', data_type: 'varchar' },
        ]);

        const { keywords, others } = await complete({
          value: 'SELECT * FROM users WHERE ',
          word: 'wh',
          keywordCase,
          tables: [{ name: 'users' }],
        });

        expect(labelsOf(others)).toEqual(['CreatedAt', 'EMAIL']);
        expect(others[0].insertText).toContain('CreatedAt');
        expect(others[1].insertText).toContain('EMAIL');
        // ...while the keywords in the same response do follow the setting.
        expect(keywords.length).toBeGreaterThan(0);
      });

      it('should keep dot-triggered column names as-is in lower mode', async () => {
        const { parseTablesFromQuery } = await import('../../src/utils/sqlAnalysis');
        (parseTablesFromQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
          new Map([['u', { name: 'users' }]]),
        );
        (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
          { name: 'CreatedAt', data_type: 'timestamp' },
        ]);

        const monaco = createMockMonaco();
        registerSqlAutocomplete(
          monaco as unknown as Parameters<typeof registerSqlAutocomplete>[0],
          'conn1',
          [{ name: 'users' }],
          null,
          undefined,
          'lower',
        );
        const provider = monaco.languages.registerCompletionItemProvider.mock.calls[0][1];
        const model = createMockModel('SELECT u.');
        model.getValueInRange = vi.fn(() => 'SELECT u.');

        const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 10 });

        expect(result.suggestions[0]?.label).toBe('CreatedAt');
        expect(result.suggestions[0]?.insertText).toContain('CreatedAt');
      });
    });
  });
});
