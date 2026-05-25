import { describe, it, expect } from 'vitest';
import {
  collectTableAliases,
  generateTableList,
  collectSelectedColumns,
  sortColumnsByOrder,
  generateSelectClause,
  generateFromClause,
  generateWhereClause,
  generateGroupByClause,
  generateHavingClause,
  generateOrderByClause,
  generateLimitClause,
  generateVisualQuerySQL,
  type QueryNode,
  type QueryEdge,
  type WhereCondition,
  type OrderByClause,
} from '../../src/utils/visualQuery';

describe('visualQuery utils', () => {
  describe('collectTableAliases', () => {
    it('should generate sequential aliases for nodes', () => {
      const nodes: QueryNode[] = [
        { id: 'node1', data: { label: 'users', columns: [], selectedColumns: {} } },
        { id: 'node2', data: { label: 'posts', columns: [], selectedColumns: {} } },
        { id: 'node3', data: { label: 'comments', columns: [], selectedColumns: {} } },
      ];

      const aliases = collectTableAliases(nodes);

      expect(aliases).toEqual({
        node1: 't1',
        node2: 't2',
        node3: 't3',
      });
    });

    it('should return empty object for empty nodes', () => {
      expect(collectTableAliases([])).toEqual({});
    });

    it('should handle single node', () => {
      const nodes: QueryNode[] = [
        { id: 'only', data: { label: 'users', columns: [], selectedColumns: {} } },
      ];

      expect(collectTableAliases(nodes)).toEqual({ only: 't1' });
    });
  });

  describe('generateTableList', () => {
    it('should generate table list with aliases', () => {
      const nodes: QueryNode[] = [
        { id: 'n1', data: { label: 'users', columns: [], selectedColumns: {} } },
        { id: 'n2', data: { label: 'posts', columns: [], selectedColumns: {} } },
      ];
      const aliases = { n1: 't1', n2: 't2' };

      const result = generateTableList(nodes, aliases);

      expect(result).toEqual(['users t1', 'posts t2']);
    });

    it('should return empty array for no nodes', () => {
      expect(generateTableList([], {})).toEqual([]);
    });
  });

  describe('collectSelectedColumns', () => {
    it('should collect simple column selections', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'users',
            columns: [{ name: 'id', type: 'INT' }, { name: 'name', type: 'VARCHAR' }],
            selectedColumns: { id: true, name: true },
          },
        },
      ];
      const aliases = { n1: 't1' };

      const result = collectSelectedColumns(nodes, aliases);

      expect(result.columns).toHaveLength(2);
      expect(result.columns[0].expr).toBe('t1.id');
      expect(result.columns[1].expr).toBe('t1.name');
      expect(result.hasAggregation).toBe(false);
      expect(result.nonAggregatedCols).toEqual(['t1.id', 't1.name']);
    });

    it('should handle aggregation functions', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'users',
            columns: [{ name: 'id', type: 'INT' }],
            selectedColumns: { id: true },
            columnAggregations: {
              id: { function: 'COUNT' },
            },
          },
        },
      ];
      const aliases = { n1: 't1' };

      const result = collectSelectedColumns(nodes, aliases);

      expect(result.columns[0].expr).toBe('COUNT(t1.id)');
      expect(result.hasAggregation).toBe(true);
      expect(result.nonAggregatedCols).toEqual([]);
    });

    it('should handle COUNT DISTINCT', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'users',
            columns: [{ name: 'email', type: 'VARCHAR' }],
            selectedColumns: { email: true },
            columnAggregations: {
              email: { function: 'COUNT_DISTINCT' },
            },
          },
        },
      ];
      const aliases = { n1: 't1' };

      const result = collectSelectedColumns(nodes, aliases);

      expect(result.columns[0].expr).toBe('COUNT(DISTINCT t1.email)');
    });

    it('should handle aggregation aliases', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'orders',
            columns: [{ name: 'total', type: 'DECIMAL' }],
            selectedColumns: { total: true },
            columnAggregations: {
              total: { function: 'SUM', alias: 'total_sum' },
            },
          },
        },
      ];
      const aliases = { n1: 't1' };

      const result = collectSelectedColumns(nodes, aliases);

      expect(result.columns[0].expr).toBe('SUM(t1.total) AS total_sum');
    });

    it('should handle column aliases without aggregation', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'users',
            columns: [{ name: 'first_name', type: 'VARCHAR' }],
            selectedColumns: { first_name: true },
            columnAliases: {
              first_name: { alias: 'name' },
            },
          },
        },
      ];
      const aliases = { n1: 't1' };

      const result = collectSelectedColumns(nodes, aliases);

      expect(result.columns[0].expr).toBe('t1.first_name AS name');
      expect(result.nonAggregatedCols).toContain('t1.first_name');
    });

    it('should handle custom ordering', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'users',
            columns: [
              { name: 'name', type: 'VARCHAR' },
              { name: 'id', type: 'INT' },
            ],
            selectedColumns: { name: true, id: true },
            columnAliases: {
              name: { order: 2 },
              id: { order: 1 },
            },
          },
        },
      ];
      const aliases = { n1: 't1' };

      const result = collectSelectedColumns(nodes, aliases);

      // Check that orders are correctly assigned (column order depends on Object.entries iteration)
      const idCol = result.columns.find(c => c.colName === 'id');
      const nameCol = result.columns.find(c => c.colName === 'name');
      expect(idCol?.order).toBe(1);
      expect(nameCol?.order).toBe(2);
    });

    it('should use default order 999 when not specified', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'users',
            columns: [{ name: 'id', type: 'INT' }],
            selectedColumns: { id: true },
          },
        },
      ];
      const aliases = { n1: 't1' };

      const result = collectSelectedColumns(nodes, aliases);

      expect(result.columns[0].order).toBe(999);
    });
  });

  describe('sortColumnsByOrder', () => {
    it('should sort columns by order ascending', () => {
      const columns = [
        { expr: 't1.name', order: 3, colName: 'name' },
        { expr: 't1.id', order: 1, colName: 'id' },
        { expr: 't1.email', order: 2, colName: 'email' },
      ];

      const sorted = sortColumnsByOrder(columns);

      expect(sorted[0].colName).toBe('id');
      expect(sorted[1].colName).toBe('email');
      expect(sorted[2].colName).toBe('name');
    });

    it('should not mutate original array', () => {
      const columns = [
        { expr: 't1.b', order: 2, colName: 'b' },
        { expr: 't1.a', order: 1, colName: 'a' },
      ];

      sortColumnsByOrder(columns);

      expect(columns[0].colName).toBe('b');
      expect(columns[1].colName).toBe('a');
    });
  });

  describe('generateSelectClause', () => {
    it('should generate SELECT with columns', () => {
      const columns = [
        { expr: 't1.id', order: 1, colName: 'id' },
        { expr: 't1.name', order: 2, colName: 'name' },
      ];

      const result = generateSelectClause(columns);

      expect(result).toBe('  t1.id,\n  t1.name');
    });

    it('should return wildcard for empty columns', () => {
      expect(generateSelectClause([])).toBe('  *');
    });

    it('should handle single column', () => {
      const columns = [{ expr: 't1.id', order: 1, colName: 'id' }];

      expect(generateSelectClause(columns)).toBe('  t1.id');
    });
  });

  describe('generateFromClause', () => {
    it('should generate simple FROM with comma-separated tables', () => {
      const nodes: QueryNode[] = [
        { id: 'n1', data: { label: 'users', columns: [], selectedColumns: {} } },
        { id: 'n2', data: { label: 'posts', columns: [], selectedColumns: {} } },
      ];
      const aliases = { n1: 't1', n2: 't2' };

      const result = generateFromClause(nodes, [], aliases);

      expect(result).toBe('\nFROM\n  users t1,\n  posts t2');
    });

    it('should generate JOIN clause', () => {
      const nodes: QueryNode[] = [
        { id: 'n1', data: { label: 'users', columns: [], selectedColumns: {} } },
        { id: 'n2', data: { label: 'posts', columns: [], selectedColumns: {} } },
      ];
      const edges: QueryEdge[] = [
        {
          id: 'e1',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'id',
          targetHandle: 'user_id',
        },
      ];
      const aliases = { n1: 't1', n2: 't2' };

      const result = generateFromClause(nodes, edges, aliases);

      expect(result).toContain('FROM');
      expect(result).toContain('users t1');
      expect(result).toContain('INNER JOIN posts t2 ON t1.id = t2.user_id');
    });

    it('should handle different join types', () => {
      const nodes: QueryNode[] = [
        { id: 'n1', data: { label: 'users', columns: [], selectedColumns: {} } },
        { id: 'n2', data: { label: 'posts', columns: [], selectedColumns: {} } },
      ];
      const edges: QueryEdge[] = [
        {
          id: 'e1',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'id',
          targetHandle: 'user_id',
          data: { joinType: 'LEFT' },
        },
      ];
      const aliases = { n1: 't1', n2: 't2' };

      const result = generateFromClause(nodes, edges, aliases);

      expect(result).toContain('LEFT JOIN');
    });

    it('should handle bidirectional edges', () => {
      const nodes: QueryNode[] = [
        { id: 'n1', data: { label: 'users', columns: [], selectedColumns: {} } },
        { id: 'n2', data: { label: 'posts', columns: [], selectedColumns: {} } },
      ];
      const edges: QueryEdge[] = [
        {
          id: 'e1',
          source: 'n2',
          target: 'n1',
          sourceHandle: 'user_id',
          targetHandle: 'id',
        },
      ];
      const aliases = { n1: 't1', n2: 't2' };

      const result = generateFromClause(nodes, edges, aliases);

      expect(result).toContain('INNER JOIN posts t2 ON t2.user_id = t1.id');
    });

    it('should handle unconnected tables with cross join', () => {
      const nodes: QueryNode[] = [
        { id: 'n1', data: { label: 'users', columns: [], selectedColumns: {} } },
        { id: 'n2', data: { label: 'posts', columns: [], selectedColumns: {} } },
        { id: 'n3', data: { label: 'comments', columns: [], selectedColumns: {} } },
      ];
      const edges: QueryEdge[] = [
        {
          id: 'e1',
          source: 'n1',
          target: 'n2',
          sourceHandle: 'id',
          targetHandle: 'user_id',
        },
      ];
      const aliases = { n1: 't1', n2: 't2', n3: 't3' };

      const result = generateFromClause(nodes, edges, aliases);

      expect(result).toContain('comments t3');
    });

    it('should return empty string for no nodes', () => {
      expect(generateFromClause([], [], {})).toBe('');
    });
  });

  describe('generateWhereClause', () => {
    it('should generate WHERE clause with single condition', () => {
      const conditions: WhereCondition[] = [
        { id: '1', column: 't1.id', operator: '=', value: '5', logicalOperator: 'AND', isAggregate: false },
      ];

      const result = generateWhereClause(conditions);

      expect(result).toBe('\nWHERE\n  t1.id = 5');
    });

    it('should generate WHERE with multiple AND conditions', () => {
      const conditions: WhereCondition[] = [
        { id: '1', column: 't1.status', operator: '=', value: "'active'", logicalOperator: 'AND', isAggregate: false },
        { id: '2', column: 't1.age', operator: '>', value: '18', logicalOperator: 'AND', isAggregate: false },
      ];

      const result = generateWhereClause(conditions);

      expect(result).toBe("\nWHERE\n  t1.status = 'active'\n  AND t1.age > 18");
    });

    it('should generate WHERE with OR conditions', () => {
      const conditions: WhereCondition[] = [
        { id: '1', column: 't1.type', operator: '=', value: "'A'", logicalOperator: 'OR', isAggregate: false },
        { id: '2', column: 't1.type', operator: '=', value: "'B'", logicalOperator: 'OR', isAggregate: false },
      ];

      const result = generateWhereClause(conditions);

      expect(result).toContain('OR');
    });

    it('should skip aggregate conditions', () => {
      const conditions: WhereCondition[] = [
        { id: '1', column: 't1.id', operator: '=', value: '5', logicalOperator: 'AND', isAggregate: false },
        { id: '2', column: 'COUNT(*)', operator: '>', value: '10', logicalOperator: 'AND', isAggregate: true },
      ];

      const result = generateWhereClause(conditions);

      expect(result).toContain('t1.id');
      expect(result).not.toContain('COUNT');
    });

    it('should skip conditions with empty column or value', () => {
      const conditions: WhereCondition[] = [
        { id: '1', column: '', operator: '=', value: '5', logicalOperator: 'AND', isAggregate: false },
        { id: '2', column: 't1.id', operator: '=', value: '', logicalOperator: 'AND', isAggregate: false },
        { id: '3', column: 't1.name', operator: '=', value: "'test'", logicalOperator: 'AND', isAggregate: false },
      ];

      const result = generateWhereClause(conditions);

      expect(result).not.toContain('t1.id');
      expect(result).toContain("t1.name = 'test'");
    });

    it('should return empty string for no conditions', () => {
      expect(generateWhereClause([])).toBe('');
    });
  });

  describe('generateGroupByClause', () => {
    it('should generate GROUP BY with non-aggregated columns', () => {
      const result = generateGroupByClause(true, ['t1.name', 't1.email'], []);

      expect(result).toBe('\nGROUP BY\n  t1.name,\n  t1.email');
    });

    it('should merge manual and auto GROUP BY', () => {
      const result = generateGroupByClause(true, ['t1.name'], ['t1.created_at']);

      expect(result).toContain('t1.name');
      expect(result).toContain('t1.created_at');
    });

    it('should remove duplicates from merged GROUP BY', () => {
      const result = generateGroupByClause(true, ['t1.name', 't1.name'], []);

      // Should not have duplicate 't1.name' entries
      const matches = result.match(/t1\.name/g);
      expect(matches).toHaveLength(1);
    });

    it('should return empty when no aggregation', () => {
      const result = generateGroupByClause(false, ['t1.name'], []);

      expect(result).toBe('');
    });

    it('should use manual GROUP BY when no aggregation', () => {
      const result = generateGroupByClause(false, [], ['t1.category']);

      expect(result).toBe('\nGROUP BY\n  t1.category');
    });

    it('should return empty for empty arrays', () => {
      expect(generateGroupByClause(false, [], [])).toBe('');
    });
  });

  describe('generateHavingClause', () => {
    it('should generate HAVING with aggregate conditions', () => {
      const conditions: WhereCondition[] = [
        { id: '1', column: 'COUNT(*)', operator: '>', value: '5', logicalOperator: 'AND', isAggregate: true },
      ];

      const result = generateHavingClause(conditions);

      expect(result).toBe('\nHAVING\n  COUNT(*) > 5');
    });

    it('should skip non-aggregate conditions', () => {
      const conditions: WhereCondition[] = [
        { id: '1', column: 't1.status', operator: '=', value: "'active'", logicalOperator: 'AND', isAggregate: false },
        { id: '2', column: 'SUM(t1.amount)', operator: '>', value: '1000', logicalOperator: 'AND', isAggregate: true },
      ];

      const result = generateHavingClause(conditions);

      expect(result).toContain('SUM');
      expect(result).not.toContain('status');
    });

    it('should return empty string for no aggregate conditions', () => {
      expect(generateHavingClause([])).toBe('');
    });
  });

  describe('generateOrderByClause', () => {
    it('should generate ORDER BY with single column', () => {
      const orderBy: OrderByClause[] = [
        { id: '1', column: 't1.name', direction: 'ASC' },
      ];

      const result = generateOrderByClause(orderBy);

      expect(result).toBe('\nORDER BY\n  t1.name ASC');
    });

    it('should generate ORDER BY with multiple columns', () => {
      const orderBy: OrderByClause[] = [
        { id: '1', column: 't1.created_at', direction: 'DESC' },
        { id: '2', column: 't1.name', direction: 'ASC' },
      ];

      const result = generateOrderByClause(orderBy);

      expect(result).toContain('t1.created_at DESC');
      expect(result).toContain('t1.name ASC');
    });

    it('should return empty string for empty orderBy', () => {
      expect(generateOrderByClause([])).toBe('');
    });

    it('should quote column names for postgres driver', () => {
      const orderBy: OrderByClause[] = [
        { id: '1', column: 'Status', direction: 'DESC' },
      ];

      expect(generateOrderByClause(orderBy, 'postgres')).toBe(
        '\nORDER BY\n  "Status" DESC',
      );
    });
  });

  describe('generateLimitClause', () => {
    it('should generate LIMIT clause', () => {
      expect(generateLimitClause('100')).toBe('\nLIMIT 100');
    });

    it('should handle whitespace in limit', () => {
      expect(generateLimitClause('  50  ')).toBe('\nLIMIT 50');
    });

    it('should return empty for empty string', () => {
      expect(generateLimitClause('')).toBe('');
    });

    it('should return empty for whitespace only', () => {
      expect(generateLimitClause('   ')).toBe('');
    });
  });

  describe('generateVisualQuerySQL', () => {
    it('should generate complete simple query', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'users',
            columns: [{ name: 'id', type: 'INT' }, { name: 'name', type: 'VARCHAR' }],
            selectedColumns: { id: true, name: true },
          },
        },
      ];

      const result = generateVisualQuerySQL(nodes, [], [], [], [], '');

      expect(result).toContain('SELECT');
      expect(result).toContain('t1.id');
      expect(result).toContain('t1.name');
      expect(result).toContain('FROM');
      expect(result).toContain('users t1');
    });

    it('should generate query with all clauses', () => {
      const nodes: QueryNode[] = [
        {
          id: 'n1',
          data: {
            label: 'orders',
            columns: [
              { name: 'id', type: 'INT' },
              { name: 'status', type: 'VARCHAR' },
              { name: 'total', type: 'DECIMAL' },
            ],
            selectedColumns: { id: true, status: true, total: true },
            columnAggregations: {
              total: { function: 'SUM', alias: 'total_sum' },
            },
          },
        },
      ];
      const whereConditions: WhereCondition[] = [
        { id: '1', column: 't1.status', operator: '=', value: "'completed'", logicalOperator: 'AND', isAggregate: false },
      ];
      const orderBy: OrderByClause[] = [
        { id: '1', column: 'total_sum', direction: 'DESC' },
      ];

      const result = generateVisualQuerySQL(nodes, [], whereConditions, orderBy, [], '10');

      expect(result).toContain('SELECT');
      expect(result).toContain('SUM(t1.total) AS total_sum');
      expect(result).toContain('WHERE');
      expect(result).toContain("t1.status = 'completed'");
      expect(result).toContain('GROUP BY');
      expect(result).toContain('t1.id');
      expect(result).toContain('t1.status');
      expect(result).toContain('ORDER BY');
      expect(result).toContain('LIMIT 10');
    });

    it('should return empty string for no nodes', () => {
      expect(generateVisualQuerySQL([], [], [], [], [], '')).toBe('');
    });
  });
});
