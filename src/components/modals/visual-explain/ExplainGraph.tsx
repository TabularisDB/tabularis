import { useEffect, useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ExplainPlan } from "../../../types/explain";
import { explainPlanToFlow } from "../../../utils/explainPlan";
import { ExplainPlanNodeComponent } from "../../ui/ExplainPlanNode";

const nodeTypes = {
  explainPlan: ExplainPlanNodeComponent,
};

interface ExplainGraphInnerProps {
  plan: ExplainPlan;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

function ExplainGraphInner({
  plan,
  selectedNodeId,
  onSelectNode,
}: ExplainGraphInnerProps) {
  const { fitView } = useReactFlow();

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => explainPlanToFlow(plan, selectedNodeId),
    [plan, selectedNodeId],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleInit = useCallback(() => {
    setTimeout(() => fitView({ padding: 0.2 }), 50);
  }, [fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onInit={handleInit}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      fitView
      proOptions={{ hideAttribution: true }}
      minZoom={0.1}
      maxZoom={2}
    >
      <Background />
      <Controls />
      {nodes.length > 10 && (
        <MiniMap
          nodeStrokeWidth={3}
          className="!bg-base !border-default"
        />
      )}
    </ReactFlow>
  );
}

interface ExplainGraphProps {
  plan: ExplainPlan;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

export const ExplainGraph = ({
  plan,
  selectedNodeId,
  onSelectNode,
}: ExplainGraphProps) => {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <ExplainGraphInner
          plan={plan}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      </ReactFlowProvider>
    </div>
  );
};
