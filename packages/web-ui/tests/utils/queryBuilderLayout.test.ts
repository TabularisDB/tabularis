import { describe, it, expect } from 'vitest';
import { layoutQueryBuilderGraph } from '../../src/utils/queryBuilderLayout';
import type { Node, Edge } from '@xyflow/react';
import type { TableNodeData } from '../../src/components/ui/TableNode';

describe('queryBuilderLayout', () => {
  it('should layout nodes without overlap', () => {
    const nodes: Node<TableNodeData>[] = [
      { id: 'a', type: 'table', position: { x: 0, y: 0 }, data: { label: 'users', columns: [{ name: 'id', type: 'INT' }], selectedColumns: {}, columnAggregations: {}, columnAliases: {} } },
      { id: 'b', type: 'table', position: { x: 0, y: 0 }, data: { label: 'posts', columns: [{ name: 'id', type: 'INT' }, { name: 'title', type: 'VARCHAR' }], selectedColumns: {}, columnAggregations: {}, columnAliases: {} } },
      { id: 'c', type: 'table', position: { x: 0, y: 0 }, data: { label: 'comments', columns: [{ name: 'id', type: 'INT' }], selectedColumns: {}, columnAggregations: {}, columnAliases: {} } },
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'join' },
      { id: 'e2', source: 'b', target: 'c', type: 'join' },
    ];

    const result = layoutQueryBuilderGraph(nodes, edges, { direction: 'LR' });

    expect(result).toHaveLength(3);
    const uniqueX = new Set(result.map((n) => Math.round(n.position.x)));
    const uniqueY = new Set(result.map((n) => Math.round(n.position.y)));
    // At least some nodes should be separated horizontally or vertically
    expect(uniqueX.size + uniqueY.size).toBeGreaterThan(2);
  });

  it('should preserve nodes in preserveNodeIds', () => {
    const nodes: Node<TableNodeData>[] = [
      { id: 'a', type: 'table', position: { x: 100, y: 200 }, data: { label: 'users', columns: [], selectedColumns: {}, columnAggregations: {}, columnAliases: {} } },
      { id: 'b', type: 'table', position: { x: 0, y: 0 }, data: { label: 'posts', columns: [], selectedColumns: {}, columnAggregations: {}, columnAliases: {} } },
    ];
    const edges: Edge[] = [];

    const result = layoutQueryBuilderGraph(nodes, edges, { direction: 'LR', preserveNodeIds: new Set(['a']) });

    const preserved = result.find((n) => n.id === 'a');
    expect(preserved?.position).toEqual({ x: 100, y: 200 });
  });
});
