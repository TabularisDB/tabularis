/**
 * Visual Query Builder - SQL Generation Utilities
 * Pure functions for generating SQL from visual query state
 */

import { formatSqlIdentifier } from "./identifiers";

export interface TableNodeData {
  label: string;
  columns: { name: string; type: string }[];
  selectedColumns: Record<string, boolean>;
  columnAggregations?: Record<string, ColumnAggregation>;
  columnAliases?: Record<string, ColumnAlias>;
}

export interface ColumnAggregation {
  function?: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
  alias?: string;
  order?: number;
}

export interface ColumnAlias {
  alias?: string;
  order?: number;
}

export interface WhereCondition {
  id: string;
  column: string;
  operator: string;
  value: string;
  logicalOperator: 'AND' | 'OR';
  isAggregate: boolean;
}

export interface OrderByClause {
  id: string;
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface JoinEdgeData {
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL OUTER' | 'CROSS';
}

export interface QueryNode {
  id: string;
  data: TableNodeData;
}

export interface QueryEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: JoinEdgeData;
}

export interface SelectedColumn {
  expr: string;
  order: number;
  colName: string;
}

/**
 * Collects tables and their aliases from nodes
 */
export function collectTableAliases(nodes: QueryNode[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  nodes.forEach((node, index) => {
    aliases[node.id] = `t${index + 1}`;
  });
  return aliases;
}

/**
 * Generates table list with aliases
 */
export function generateTableList(nodes: QueryNode[], aliases: Record<string, string>): string[] {
  return nodes.map((node) => {
    const tableName = node.data.label;
    const alias = aliases[node.id];
    return `${tableName} ${alias}`;
  });
}

/**
 * Collects selected columns with their expressions and ordering
 */
export function collectSelectedColumns(
  nodes: QueryNode[],
  aliases: Record<string, string>
): { columns: SelectedColumn[]; hasAggregation: boolean; nonAggregatedCols: string[] } {
  const selectedColsWithOrder: SelectedColumn[] = [];
  const nonAggregatedCols: string[] = [];
  let hasAggregation = false;

  nodes.forEach((node) => {
    const data = node.data;
    const alias = aliases[node.id];

    if (data.selectedColumns) {
      Object.entries(data.selectedColumns).forEach(([col, isChecked]) => {
        if (isChecked) {
          const agg = data.columnAggregations?.[col];
          const colAlias = data.columnAliases?.[col];
          let colExpr = `${alias}.${col}`;
          let order = 999;

          if (agg?.function) {
            hasAggregation = true;
            if (agg.function === 'COUNT_DISTINCT') {
              colExpr = `COUNT(DISTINCT ${alias}.${col})`;
            } else {
              colExpr = `${agg.function}(${alias}.${col})`;
            }

            if (agg?.alias) {
              colExpr += ` AS ${agg.alias}`;
            }

            if (agg?.order !== undefined) {
              order = agg.order;
            }
          } else {
            nonAggregatedCols.push(`${alias}.${col}`);

            if (colAlias?.alias) {
              colExpr += ` AS ${colAlias.alias}`;
            }

            if (colAlias?.order !== undefined) {
              order = colAlias.order;
            }
          }

          selectedColsWithOrder.push({ expr: colExpr, order, colName: col });
        }
      });
    }
  });

  return { columns: selectedColsWithOrder, hasAggregation, nonAggregatedCols };
}

/**
 * Sorts columns by their order property
 */
export function sortColumnsByOrder(columns: SelectedColumn[]): SelectedColumn[] {
  return [...columns].sort((a, b) => a.order - b.order);
}

/**
 * Generates the SELECT clause
 */
export function generateSelectClause(columns: SelectedColumn[]): string {
  const sorted = sortColumnsByOrder(columns);
  const colExprs = sorted.map((c) => c.expr);
  return colExprs.length > 0 ? `  ${colExprs.join(',\n  ')}` : '  *';
}

/**
 * Generates the FROM clause with JOINs
 */
export function generateFromClause(
  nodes: QueryNode[],
  edges: QueryEdge[],
  aliases: Record<string, string>
): string {
  if (nodes.length === 0) return '';

  const tableList = generateTableList(nodes, aliases);

  if (edges.length === 0) {
    return '\nFROM\n  ' + tableList.join(',\n  ');
  }

  const firstNode = nodes[0];
  const firstData = firstNode.data;
  const processedNodes = new Set<string>([firstNode.id]);

  let sql = `\nFROM\n  ${firstData.label} ${aliases[firstNode.id]}`;

  const edgesToProcess = [...edges];
  let madeProgress = true;

  while (edgesToProcess.length > 0 && madeProgress) {
    madeProgress = false;

    for (let i = 0; i < edgesToProcess.length; i++) {
      const edge = edgesToProcess[i];
      const isSourceProcessed = processedNodes.has(edge.source);
      const isTargetProcessed = processedNodes.has(edge.target);

      if (isSourceProcessed && !isTargetProcessed) {
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (targetNode) {
          const targetData = targetNode.data;
          const targetAlias = aliases[edge.target];
          const sourceAlias = aliases[edge.source];
          const edgeData = edge.data;
          const joinType = edgeData?.joinType || 'INNER';
          sql += `\n${joinType} JOIN ${targetData.label} ${targetAlias} ON ${sourceAlias}.${edge.sourceHandle} = ${targetAlias}.${edge.targetHandle}`;
          processedNodes.add(edge.target);
          edgesToProcess.splice(i, 1);
          madeProgress = true;
          break;
        }
      } else if (!isSourceProcessed && isTargetProcessed) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        if (sourceNode) {
          const sourceData = sourceNode.data;
          const sourceAlias = aliases[edge.source];
          const targetAlias = aliases[edge.target];
          const edgeData = edge.data;
          const joinType = edgeData?.joinType || 'INNER';
          sql += `\n${joinType} JOIN ${sourceData.label} ${sourceAlias} ON ${sourceAlias}.${edge.sourceHandle} = ${targetAlias}.${edge.targetHandle}`;
          processedNodes.add(edge.source);
          edgesToProcess.splice(i, 1);
          madeProgress = true;
          break;
        }
      } else if (isSourceProcessed && isTargetProcessed) {
        edgesToProcess.splice(i, 1);
        i--;
      }
    }
  }

  // Add remaining unconnected tables as cross joins
  nodes.forEach((node) => {
    if (!processedNodes.has(node.id)) {
      const data = node.data;
      sql += `,\n  ${data.label} ${aliases[node.id]}`;
    }
  });

  return sql;
}

/**
 * Generates WHERE clause for non-aggregate conditions
 */
export function generateWhereClause(conditions: WhereCondition[]): string {
  const normalConditions = conditions.filter((c) => !c.isAggregate && c.column && c.value);

  if (normalConditions.length === 0) return '';

  const clauses = normalConditions.map((c, idx) => {
    const condition = `${c.column} ${c.operator} ${c.value}`;
    return idx === 0 ? condition : `${c.logicalOperator} ${condition}`;
  });

  return '\nWHERE\n  ' + clauses.join('\n  ');
}

/**
 * Generates GROUP BY clause
 */
export function generateGroupByClause(
  hasAggregation: boolean,
  nonAggregatedCols: string[],
  manualGroupBy: string[]
): string {
  const finalGroupBy =
    hasAggregation && nonAggregatedCols.length > 0
      ? [...new Set([...nonAggregatedCols, ...manualGroupBy])]
      : manualGroupBy.length > 0
        ? manualGroupBy
        : [];

  if (finalGroupBy.length === 0) return '';

  return '\nGROUP BY\n  ' + finalGroupBy.join(',\n  ');
}

/**
 * Generates HAVING clause for aggregate conditions
 */
export function generateHavingClause(conditions: WhereCondition[]): string {
  const aggregateConditions = conditions.filter((c) => c.isAggregate && c.column && c.value);

  if (aggregateConditions.length === 0) return '';

  const clauses = aggregateConditions.map((c, idx) => {
    const condition = `${c.column} ${c.operator} ${c.value}`;
    return idx === 0 ? condition : `${c.logicalOperator} ${condition}`;
  });

  return '\nHAVING\n  ' + clauses.join('\n  ');
}

/**
 * Generates ORDER BY clause
 */
export function generateOrderByClause(
  orderBy: OrderByClause[],
  driver?: string | null,
): string {
  if (orderBy.length === 0) return '';

  const clauses = orderBy.map(
    (o) => `${formatSqlIdentifier(o.column, driver)} ${o.direction}`,
  );
  return '\nORDER BY\n  ' + clauses.join(',\n  ');
}

/**
 * Generates LIMIT clause
 */
export function generateLimitClause(limit: string): string {
  if (!limit || !limit.trim()) return '';
  return `\nLIMIT ${limit.trim()}`;
}

/**
 * Generates complete SQL query from visual query state
 */
export function generateVisualQuerySQL(
  nodes: QueryNode[],
  edges: QueryEdge[],
  whereConditions: WhereCondition[],
  orderBy: OrderByClause[],
  groupBy: string[],
  limit: string,
  driver?: string | null,
): string {
  if (nodes.length === 0) return '';

  const aliases = collectTableAliases(nodes);
  const { columns, hasAggregation, nonAggregatedCols } = collectSelectedColumns(nodes, aliases);

  let sql = 'SELECT\n';
  sql += generateSelectClause(columns);
  sql += generateFromClause(nodes, edges, aliases);
  sql += generateWhereClause(whereConditions);
  sql += generateGroupByClause(hasAggregation, nonAggregatedCols, groupBy);
  sql += generateHavingClause(whereConditions);
  sql += generateOrderByClause(orderBy, driver);
  sql += generateLimitClause(limit);

  return sql;
}
