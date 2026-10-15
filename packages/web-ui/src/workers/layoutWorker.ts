import dagre from 'dagre';
import {
  NODE_WIDTH,
  calculateNodeHeight,
  getNodePositions,
  calculateCenteredPosition,
} from '../utils/layoutWorker';

interface WorkerNode {
  id: string;
  data?: {
    columns?: unknown[];
  };
  [key: string]: unknown;
}

interface WorkerEdge {
  source: string;
  target: string;
  [key: string]: unknown;
}

interface WorkerMessage {
  nodes: WorkerNode[];
  edges: WorkerEdge[];
  direction: string;
}

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { nodes, edges, direction } = e.data;

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep: 150, nodesep: 50 });

  nodes.forEach((node: WorkerNode) => {
    const columns = node.data?.columns?.length || 0;
    const height = calculateNodeHeight(columns);
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height });
  });

  edges.forEach((edge: WorkerEdge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node: WorkerNode) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const { sourcePosition, targetPosition } = getNodePositions(direction);
    const position = calculateCenteredPosition(
      nodeWithPosition.x,
      nodeWithPosition.y,
      NODE_WIDTH,
      dagreGraph.node(node.id).height
    );

    return {
      ...node,
      sourcePosition,
      targetPosition,
      position,
    };
  });

  self.postMessage({ nodes: layoutedNodes, edges });
};
