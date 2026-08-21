import { useEffect, useState, useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  Position,
  useReactFlow,
  ReactFlowProvider,
  ControlButton,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { useEditor } from "../../hooks/useEditor";
import { SchemaTableNodeComponent } from "./SchemaTableNode";
import {
  Loader2,
  ArrowLeftRight,
  ArrowUpDown,
  Maximize2,
  Focus,
  Download,
  ChevronDown,
  Lock,
  LockOpen,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { generateMermaidErDiagram, generateDbml } from "../../utils/schemaExport";
import { useAlert } from "../../hooks/useAlert";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "./ContextMenu";
import { useSearchParams } from "react-router-dom";
import { useSettings } from "../../hooks/useSettings";
import { DEFAULT_SETTINGS } from "../../contexts/SettingsContext";

const nodeTypes = {
  schemaTable: SchemaTableNodeComponent,
};

const ANIMATION_THRESHOLD = 50;

// The table node grows with its content (min-w-[220px], no max width), so the
// layout must estimate the rendered size per node: a fixed width lets wide
// nodes (long column names or types) overlap their neighbors.
const estimateNodeSize = (node: Node) => {
  const nodeData = node.data as {
    label?: string;
    columns?: { name: string; type: string }[];
  };
  const columns = nodeData.columns ?? [];

  // Header: px-3 padding (24) + status dot with gap (16) + text-sm bold label
  const headerWidth = 40 + (nodeData.label?.length ?? 0) * 8.5;
  // Row: px-3 padding (24) + icon with gap (18) + mono text-xs name
  // + ml-2 (8) + mono text-[10px] type (shrink-0, never truncated)
  const widestRow = columns.reduce(
    (max, col) => Math.max(max, 50 + col.name.length * 7.5 + col.type.length * 6.5),
    0,
  );
  const width = Math.max(220, Math.ceil(Math.max(headerWidth, widestRow)));

  // Header ~38px (py-2 + text-sm + border), rows ~29px (py-1.5 + text-xs + border)
  const height = 38 + columns.length * 29;

  return { width, height };
};

const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[],
  direction = "TB",  // Changed default
) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  // FIX: Swap LR<->TB to correct the inversion bug
  const dagreDirection = direction === "LR" ? "TB" : "LR";
  dagreGraph.setGraph({ rankdir: dagreDirection, ranksep: 150, nodesep: 60 });

  nodes.forEach((node) => {
    const { width, height } = estimateNodeSize(node);
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      // FIX: Swap positions to match inverted direction
      targetPosition: direction === "LR" ? Position.Top : Position.Left,
      sourcePosition: direction === "LR" ? Position.Bottom : Position.Right,
      position: {
        x: nodeWithPosition.x - nodeWithPosition.width / 2,
        y: nodeWithPosition.y - nodeWithPosition.height / 2,
      },
    };
  });

  return { nodes: newNodes, edges };
};

interface SchemaDiagramContentProps {
  connectionId: string;
  refreshTrigger: number;
  schema?: string;
}

const SchemaDiagramContent = ({
  connectionId,
  refreshTrigger,
  schema,
}: SchemaDiagramContentProps) => {
  const { t } = useTranslation();
  const { getSchema } = useEditor();
  const { showAlert } = useAlert();
  const { settings } = useSettings();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const [loading, setLoading] = useState(false);
  
  // Use settings value directly, with fallback to default
  const layoutDirectionFromSettings = (settings.erDiagramDefaultLayout ?? DEFAULT_SETTINGS.erDiagramDefaultLayout) as "LR" | "TB";
  // Track user override - null means use settings, otherwise use user's manual selection
  const [layoutDirectionOverride, setLayoutDirectionOverride] = useState<"LR" | "TB" | null>(null);
  
  // Use user override if set, otherwise use settings
  const layoutDirection = layoutDirectionOverride ?? layoutDirectionFromSettings;
  
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [nodesLocked, setNodesLocked] = useState(true);
  const [allNodes, setAllNodes] = useState<Node[]>([]);
  const [allEdges, setAllEdges] = useState<Edge[]>([]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tableId: string;
  } | null>(null);
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [searchParams] = useSearchParams();

  // Callback per gestire il click su una tabella
  const handleTableClick = useCallback((tableId: string) => {
    setSelectedTable((prev) => (prev === tableId ? null : tableId));
  }, []);

  // Gestione click sui nodi tramite React Flow
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      handleTableClick(node.id);
    },
    [handleTableClick],
  );

  // Gestione context menu sui nodi tramite React Flow
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, tableId: node.id });
    },
    [],
  );

  // Callback per cambiare la direzione del layout
  const toggleLayoutDirection = useCallback(() => {
    setLayoutDirectionOverride((prev) => {
      const current = prev ?? layoutDirectionFromSettings;
      return current === "LR" ? "TB" : "LR";
    });
  }, [layoutDirectionFromSettings]);

  // Export the full schema as a Mermaid erDiagram. Uses allNodes/allEdges
  // rather than the rendered nodes so the export stays complete even while a
  // single table is focused.
  const handleExport = useCallback(
    async (format: "mermaid" | "dbml") => {
      if (allNodes.length === 0) return;

      const isMermaid = format === "mermaid";
      const extension = isMermaid ? "mmd" : "dbml";

      try {
        const filePath = await save({
          filters: [
            {
              name: isMermaid ? "Mermaid" : "DBML",
              extensions: [extension],
            },
          ],
          defaultPath: `schema_${new Date().toISOString().slice(0, 10)}.${extension}`,
        });
        if (!filePath) return;

        const content = isMermaid
          ? generateMermaidErDiagram(allNodes, allEdges)
          : generateDbml(allNodes, allEdges);

        await writeTextFile(filePath, content);
        showAlert(t("erDiagram.exportSuccess"), { kind: "info" });
      } catch (err) {
        showAlert(String(err), { kind: "error" });
      }
    },
    [allNodes, allEdges, showAlert, t],
  );

  // Callback per tornare alla vista completa
  const handleResetView = useCallback(() => {
    setSelectedTable(null);
  }, []);

  // Effetto per impostare il focus iniziale dalla URL
  useEffect(() => {
    const focusTable = searchParams.get("focusTable");
    if (focusTable && allNodes.length > 0) {
      // Verifica che la tabella esista
      const tableExists = allNodes.some((node) => node.id === focusTable);
      if (tableExists) {
        setSelectedTable(focusTable);
      }
    }
  }, [searchParams, allNodes]);

  // Keyboard shortcuts for zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomIn, zoomOut]);
  // Main effect to load schema from backend
  useEffect(() => {
    let isMounted = true;

    const loadSchema = async () => {
      if (!connectionId) return;
      setLoading(true);

      try {
        const fetchedSchema = await getSchema(connectionId, undefined, schema);
        if (!isMounted) return;

        // Build nodes and edges with optimizations
        const initialNodes: Node[] = [];
        const initialEdges: Edge[] = [];
        const tableSet = new Set(fetchedSchema.map((t) => t.name));

        fetchedSchema.forEach((table) => {
          // Build FK lookup Set ONCE per table for O(1) lookups
          const fkColumnNames = new Set(
            table.foreign_keys.map((fk) => fk.column_name),
          );

          initialNodes.push({
            id: table.name,
            type: "schemaTable",
            position: { x: 0, y: 0 },
            data: {
              label: table.name,
              columns: table.columns.map((c) => ({
                name: c.name,
                type: c.data_type,
                isPk: c.is_pk,
                isFk: fkColumnNames.has(c.name), // O(1) lookup
              })),
            },
          });

          table.foreign_keys.forEach((fk) => {
            if (tableSet.has(fk.ref_table)) {
              initialEdges.push({
                id: `e-${table.name}-${fk.column_name}-${fk.ref_table}-${fk.ref_column}`,
                source: table.name,
                target: fk.ref_table,
                sourceHandle: fk.column_name,
                targetHandle: fk.ref_column,
                animated: initialEdges.length < ANIMATION_THRESHOLD, // Conditional animation
                style: { stroke: "#6366f1", strokeWidth: 1.5 },
                type: "smoothstep",
              });
            }
          });
        });

        // Calculate layout
        const { nodes: layoutedNodes, edges: layoutedEdges } =
          getLayoutedElements(initialNodes, initialEdges, layoutDirection);

        if (isMounted) {
          setAllNodes(layoutedNodes);
          setAllEdges(layoutedEdges);
          setNodes(layoutedNodes);
          setEdges(layoutedEdges);

          // Fit view after rendering
          setTimeout(() => {
            if (isMounted) {
              fitView({ padding: 0.2 });
            }
          }, 100);
        }
      } catch (e) {
        console.error("Failed to load schema diagram", e);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadSchema();

    return () => {
      isMounted = false;
    };
  }, [
    connectionId,
    refreshTrigger,
    getSchema,
    fitView,
    setNodes,
    setEdges,
    layoutDirection,
    schema,
  ]);

  // Effetto per filtrare i nodi quando una tabella è selezionata
  useEffect(() => {
    if (!selectedTable || allNodes.length === 0) {
      // Mostra tutti i nodi
      setNodes(allNodes);
      setEdges(allEdges);
      setTimeout(() => fitView({ padding: 0.2 }), 100);
      return;
    }

    // Trova tutte le tabelle correlate
    const relatedTables = new Set<string>([selectedTable]);
    
    // Trova tutte le tabelle che hanno FK verso la tabella selezionata o viceversa
    allEdges.forEach((edge) => {
      if (edge.source === selectedTable) {
        relatedTables.add(edge.target);
      }
      if (edge.target === selectedTable) {
        relatedTables.add(edge.source);
      }
    });

    // Filtra i nodi per mostrare solo la tabella selezionata e le sue relazioni
    const filteredNodes = allNodes.filter((node) =>
      relatedTables.has(node.id),
    );

    // Filtra gli edge per mostrare solo quelli tra le tabelle filtrate
    const filteredEdges = allEdges.filter(
      (edge) =>
        relatedTables.has(edge.source) && relatedTables.has(edge.target),
    );

    // Ricalcola il layout per i nodi filtrati
    const { nodes: layoutedNodes, edges: layoutedEdges } =
      getLayoutedElements(filteredNodes, filteredEdges, layoutDirection);

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);

    setTimeout(() => fitView({ padding: 0.2 }), 100);
  }, [selectedTable, allNodes, allEdges, setNodes, setEdges, fitView, layoutDirection]);

  // Conditionally show MiniMap only for medium-sized schemas
  const shouldShowMiniMap = useMemo(() => {
    const nodeCount = nodes.length;
    return nodeCount >= 10 && nodeCount <= 100;
  }, [nodes.length]);

  return (
    <div className="w-full h-full relative bg-base">
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-secondary">
            <Loader2 size={32} className="animate-spin text-indigo-500" />
            <span>Generating Diagram...</span>
          </div>
        </div>
      )}

      {/* Toolbar per i controlli */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <button
          onClick={toggleLayoutDirection}
          className="flex items-center gap-2 px-3 py-2 bg-elevated hover:bg-surface-secondary text-primary rounded-lg border border-strong transition-colors shadow-lg text-sm font-medium"
          title={
            layoutDirection === "LR"
              ? t("erDiagram.switchToVertical")
              : t("erDiagram.switchToHorizontal")
          }
        >
          {layoutDirection === "LR" ? (
            <>
              <ArrowLeftRight size={16} />
              <span>{t("erDiagram.horizontal")}</span>
            </>
          ) : (
            <>
              <ArrowUpDown size={16} />
              <span>{t("erDiagram.vertical")}</span>
            </>
          )}
        </button>

        <button
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setExportMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
          disabled={allNodes.length === 0}
          className="flex items-center gap-2 px-3 py-2 bg-elevated hover:bg-surface-secondary text-primary rounded-lg border border-strong transition-colors shadow-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          title={t("erDiagram.export")}
        >
          <Download size={16} />
          <span>{t("erDiagram.export")}</span>
          <ChevronDown size={14} />
        </button>

        {selectedTable && (
          <button
            onClick={handleResetView}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg border border-indigo-500 transition-colors shadow-lg text-sm font-medium"
            title={t("erDiagram.showAllTables")}
          >
            <Maximize2 size={16} />
            <span>{t("erDiagram.showAll")}</span>
          </button>
        )}
      </div>

      {selectedTable && (
        <div className="absolute top-4 right-4 z-10 px-4 py-2 bg-indigo-600 text-white rounded-lg border border-indigo-500 shadow-lg text-sm font-medium">
          {t("erDiagram.focusedOn")}: {selectedTable}
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.05}
        maxZoom={2}
        defaultEdgeOptions={{ type: "smoothstep" }}
        nodesDraggable={!nodesLocked}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnScroll={false}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        panOnDrag={true}
      >
        <Background gap={20} size={1} color="#334155" />
        <Controls
          className="!bg-surface-secondary !border-strong !shadow-xl"
          showInteractive={false}
        >
          <ControlButton
            onClick={() => setNodesLocked((prev) => !prev)}
            title={
              nodesLocked
                ? t("erDiagram.unlockNodes")
                : t("erDiagram.lockNodes")
            }
          >
            {nodesLocked ? <Lock size={14} /> : <LockOpen size={14} />}
          </ControlButton>
        </Controls>
        {shouldShowMiniMap && (
          <MiniMap
            nodeColor={() => "#6366f1"}
            maskColor="rgba(15, 23, 42, 0.9)"
            className="!bg-elevated !border !border-default !shadow-xl"
            style={{ height: 120, width: 200 }}
          />
        )}
      </ReactFlow>

      {/* Context Menu */}
      {exportMenu && (
        <ContextMenu
          x={exportMenu.x}
          y={exportMenu.y}
          onClose={() => setExportMenu(null)}
          items={[
            {
              label: t("erDiagram.exportMermaid"),
              icon: Download,
              action: () => handleExport("mermaid"),
            },
            {
              label: t("erDiagram.exportDbml"),
              icon: Download,
              action: () => handleExport("dbml"),
            },
          ]}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: t("erDiagram.focusOnTable"),
              icon: Focus,
              action: () => {
                setSelectedTable(contextMenu.tableId);
              },
            },
            ...(selectedTable
              ? [
                  {
                    label: t("erDiagram.showAll"),
                    icon: Maximize2,
                    action: () => {
                      setSelectedTable(null);
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
};

interface SchemaDiagramProps {
  connectionId: string;
  refreshTrigger: number;
  schema?: string;
}

export const SchemaDiagram = ({
  connectionId,
  refreshTrigger,
  schema,
}: SchemaDiagramProps) => (
  <ReactFlowProvider>
    <SchemaDiagramContent
      connectionId={connectionId}
      refreshTrigger={refreshTrigger}
      schema={schema}
    />
  </ReactFlowProvider>
);
