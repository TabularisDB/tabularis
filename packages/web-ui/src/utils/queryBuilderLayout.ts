import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { TableNodeData } from '../components/ui/TableNode';

const NODE_WIDTH = 220;
const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 40;
const RANK_SEP = 180;
const NODE_SEP = 60;

export interface LayoutOptions {
  direction?: 'LR' | 'TB';
  preserveNodeIds?: Set<string>;
}

export function layoutQueryBuilderGraph(
  nodes: Node<TableNodeData>[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node<TableNodeData>[] {
  const { direction = 'LR', preserveNodeIds } = options;

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
  });

  nodes.forEach((node) => {
    const height = HEADER_HEIGHT + (node.data.columns?.length ?? 0) * ROW_HEIGHT;
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  return nodes.map((node) => {
    if (preserveNodeIds?.has(node.id)) {
      return node;
    }

    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - nodeWithPosition.height / 2,
      },
    };
  });
}
