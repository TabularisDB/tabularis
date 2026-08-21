import { useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react';

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL OUTER' | 'CROSS';

export interface JoinEdgeData extends Record<string, unknown> {
  joinType?: JoinType;
}

export const JoinEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) => {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const joinType: JoinType = ((data as JoinEdgeData)?.joinType) || 'INNER';

  const cycleJoinType = useCallback(() => {
    const types: JoinType[] = [
      'INNER',
      'LEFT',
      'RIGHT',
      'FULL OUTER',
      'CROSS',
    ];
    const currentIndex = types.indexOf(joinType);
    const nextIndex = (currentIndex + 1) % types.length;
    const nextType = types[nextIndex];

    setEdges((edges) =>
      edges.map((edge) =>
        edge.id === id
          ? { ...edge, data: { ...edge.data, joinType: nextType }, label: nextType }
          : edge
      )
    );
  }, [id, joinType, setEdges]);

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <button
            onClick={cycleJoinType}
            className="bg-surface-secondary border border-strong rounded px-2 py-1 text-xs font-medium text-blue-400 hover:bg-surface-tertiary hover:border-blue-500 transition-all shadow-lg"
          >
            {joinType}
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
