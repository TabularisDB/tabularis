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

    it('suggests only keywords on an empty buffer', async () => {
      const provider = setup();
      const model = createMockModel('');
      const result = await provider.provideCompletionItems(model, { lineNumber: 1, column: 1 });

      const groups = groupsOf(result.suggestions);
      expect(groups.keywords).toBeGreaterThan(0);
      expect(groups.tables).toBe(0);
      expect(groups.columns).toBe(0);
    });
  });
});
