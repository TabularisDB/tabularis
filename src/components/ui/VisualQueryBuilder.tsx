import { useCallback, useEffect, useState } from 'react';
import { 
  ReactFlow, 
  Background, 
  Controls, 
  MiniMap, 
  useNodesState, 
  useEdgesState, 
  addEdge,
  type Connection,
  type Edge,
  type Node,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TableNodeComponent, type TableNodeData, type ColumnAggregation } from './TableNode';
import { JoinEdge } from './JoinEdge';
import { useDatabase } from '../../hooks/useDatabase';
import { invoke } from '@tauri-apps/api/core';
import { dragState } from '../../utils/dragState';
import { useEditor } from '../../hooks/useEditor';
import { Filter, SortAsc, Group, Hash, X, Plus } from 'lucide-react';
import { generateVisualQuerySQL, type WhereCondition, type OrderByClause } from '../../utils/visualQuery';

const nodeTypes = {
  table: TableNodeComponent,
};

const edgeTypes = {
  join: JoinEdge,
};

interface TableColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_nullable: boolean;
}

const VisualQueryBuilderContent = () => {
  const { activeConnectionId, activeDriver, activeSchema } = useDatabase();
  const { activeTab, activeTabId, updateTab } = useEditor();
  const { screenToFlowPosition } = useReactFlow();
  
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(activeTab?.flowState?.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(activeTab?.flowState?.edges || []);
  const [showSettings, setShowSettings] = useState(true);
  
  // Query Settings State
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([]);
  const [orderBy, setOrderBy] = useState<OrderByClause[]>([]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [limit, setLimit] = useState<string>('');

  // Handle Column Check
  const onColumnCheck = useCallback((nodeId: string, column: string, checked: boolean) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          const data = node.data as TableNodeData;
          return {
            ...node,
            data: {
              ...data,
              selectedColumns: {
                ...data.selectedColumns,
                [column]: checked,
              },
            },
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Handle Column Aggregation
  const onColumnAggregation = useCallback((nodeId: string, column: string, aggregation: ColumnAggregation) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          const data = node.data as TableNodeData;
          return {
            ...node,
            data: {
              ...data,
              columnAggregations: {
                ...data.columnAggregations,
                [column]: aggregation,
              },
            },
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Handle Column Alias
  const onColumnAlias = useCallback((nodeId: string, column: string, alias: string, order?: number) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          const data = node.data as TableNodeData;
          return {
            ...node,
            data: {
              ...data,
              columnAliases: {
                ...data.columnAliases,
                [column]: { alias, order },
              },
            },
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Delete node handler
  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }, [setNodes, setEdges]);

  // Restore handlers on mount (if loading from state)
  useEffect(() => {
     setNodes((nds) => nds.map(n => ({
         ...n,
         data: {
             ...(n.data as TableNodeData),
             onColumnCheck: (col: string, checked: boolean) => onColumnCheck(n.id, col, checked),
             onColumnAggregation: (col: string, agg: ColumnAggregation) => onColumnAggregation(n.id, col, agg),
             onColumnAlias: (col: string, alias: string, order?: number) => onColumnAlias(n.id, col, alias, order),
             onDelete: () => deleteNode(n.id),
         }
     })));
  }, [deleteNode, onColumnCheck, onColumnAggregation, onColumnAlias]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist State
  useEffect(() => {
      if (!activeTabId) return;
      const timer = setTimeout(() => {
          updateTab(activeTabId, { flowState: { nodes, edges } });
      }, 500);
      return () => clearTimeout(timer);
  }, [nodes, edges, activeTabId, updateTab]);

  // Generate SQL whenever nodes or edges change
  useEffect(() => {
    if (!activeTabId) return;

    const sql = generateVisualQuerySQL(
      nodes as Node<TableNodeData>[],
      edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
        data: edge.data as { joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL OUTER' | 'CROSS' } | undefined,
      })),
      whereConditions,
      orderBy,
      groupBy,
      limit,
      activeDriver,
    );

    if (sql) {
      updateTab(activeTabId, { query: sql });
    }
  }, [nodes, edges, activeTabId, updateTab, whereConditions, orderBy, groupBy, limit, activeDriver]);

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdge = {
        ...params,
        type: 'join',
        data: { joinType: 'INNER' },
        label: 'INNER',
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges],
  );

  const onPointerUp = useCallback(
    async (event: React.PointerEvent) => {
      const tableName = dragState.table;
      if (!tableName || !activeConnectionId) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      try {
        const columns = await invoke<TableColumn[]>("get_columns", { connectionId: activeConnectionId, tableName, ...(activeSchema ? { schema: activeSchema } : {}) });
        const newNodeId = `${tableName}-${Date.now()}`;

        const newNode: Node = {
          id: newNodeId,
          type: 'table',
          position,
          data: {
            label: tableName,
            columns: columns.map(c => ({ name: c.name, type: c.data_type })),
            selectedColumns: {},
            columnAggregations: {},
            columnAliases: {},
            onColumnCheck: (col: string, checked: boolean) => onColumnCheck(newNodeId, col, checked),
            onColumnAggregation: (col: string, agg: ColumnAggregation) => onColumnAggregation(newNodeId, col, agg),
            onColumnAlias: (col: string, alias: string, order?: number) => onColumnAlias(newNodeId, col, alias, order),
            onDelete: () => deleteNode(newNodeId),
          },
        };

        setNodes((nds) => nds.concat(newNode));
      } catch (e) {
        console.error("Failed to fetch columns", e);
      }
    },
    [activeConnectionId, screenToFlowPosition, setNodes, onColumnCheck, onColumnAggregation, onColumnAlias, deleteNode, activeSchema],
  );

  // Get all available columns from all nodes
  const getAllColumns = useCallback(() => {
    const cols: string[] = [];
    nodes.forEach((node, index) => {
      const data = node.data as TableNodeData;
      const alias = `t${index + 1}`;
      data.columns.forEach(col => {
        cols.push(`${alias}.${col.name}`);
      });
    });
    return cols;
  }, [nodes]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex' }}>
      <div style={{ flex: 1, position: 'relative' }} onPointerUp={onPointerUp}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          panActivationKeyCode={null}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          zoomOnScroll={true}
          zoomOnPinch={true}
          panOnScroll={false}
          panOnDrag={true}
          zoomOnDoubleClick={false}
          preventScrolling={true}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: '#3b82f6', strokeWidth: 2 },
          }}
        >
          <Controls 
            className="!bg-surface-secondary !border-strong !shadow-xl"
            showInteractive={false}
          />
          <MiniMap 
            nodeColor={() => '#3b82f6'}
            maskColor="rgba(15, 23, 42, 0.85)"
            className="!bg-elevated !border !border-strong !shadow-xl"
            style={{
              backgroundColor: '#0f172a',
              width: 150,
              height: 100,
            }}
            zoomable
            pannable
          />
          <Background gap={16} size={1} color="#1e293b" />
        </ReactFlow>
      </div>

      {/* Settings Sidebar */}
      {showSettings && (
        <div className="w-96 bg-elevated border-l border-default flex flex-col overflow-hidden shadow-2xl">
          <div className="px-5 py-4 border-b border-default flex items-center justify-between bg-base">
            <h3 className="font-semibold text-base text-primary">Query Settings</h3>
            <button 
              onClick={() => setShowSettings(false)} 
              className="text-muted hover:text-white transition-colors p-1.5 hover:bg-surface-secondary rounded"
              title="Collapse Settings"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {/* WHERE Conditions */}
            <div className="p-5 border-b border-default">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Filter size={16} className="text-blue-400" />
                  WHERE Conditions
                </div>
                <button
                  onClick={() => setWhereConditions([...whereConditions, { 
                    id: Date.now().toString(), 
                    column: '', 
                    operator: '=', 
                    value: '',
                    logicalOperator: 'AND',
                    isAggregate: false
                  }])}
                  className="text-blue-500 hover:text-blue-400 transition-colors p-1.5 hover:bg-blue-500/10 rounded"
                  title="Add condition"
                >
                  <Plus size={16} />
                </button>
              </div>
              {whereConditions.length === 0 && (
                <div className="text-xs text-muted italic py-2">No conditions added</div>
              )}
              {whereConditions.map((condition, idx) => (
                <div key={condition.id} className="flex flex-col gap-2 mb-3 p-3 bg-surface-secondary/50 rounded-lg border border-strong/50">
                  {/* Logical Operator (AND/OR) - only show for 2nd+ conditions */}
                  {idx > 0 && (
                    <div className="flex gap-2 mb-1">
                      <button
                        onClick={() => setWhereConditions(whereConditions.map(c => 
                          c.id === condition.id ? { ...c, logicalOperator: 'AND' } : c
                        ))}
                        className={`flex-1 px-3 py-1 text-xs font-medium rounded transition-colors ${
                          condition.logicalOperator === 'AND' 
                            ? 'bg-blue-500 text-white' 
                            : 'bg-surface-tertiary text-secondary hover:bg-surface-tertiary'
                        }`}
                      >
                        AND
                      </button>
                      <button
                        onClick={() => setWhereConditions(whereConditions.map(c => 
                          c.id === condition.id ? { ...c, logicalOperator: 'OR' } : c
                        ))}
                        className={`flex-1 px-3 py-1 text-xs font-medium rounded transition-colors ${
                          condition.logicalOperator === 'OR' 
                            ? 'bg-purple-500 text-white' 
                            : 'bg-surface-tertiary text-secondary hover:bg-surface-tertiary'
                        }`}
                      >
                        OR
                      </button>
                    </div>
                  )}
                  
                  {/* Column Selection */}
                  <select
                    value={condition.column}
                    onChange={(e) => setWhereConditions(whereConditions.map(c => c.id === condition.id ? { ...c, column: e.target.value } : c))}
                    className="w-full bg-surface-secondary border border-strong rounded-md px-3 py-2.5 text-sm text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                    <option value="">Select column</option>
                    {getAllColumns().map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                  
                  {/* Aggregate Toggle */}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`agg-${condition.id}`}
                      checked={condition.isAggregate}
                      onChange={(e) => setWhereConditions(whereConditions.map(c => 
                        c.id === condition.id ? { ...c, isAggregate: e.target.checked } : c
                      ))}
                      className="rounded border-strong bg-surface-tertiary text-purple-500 focus:ring-0 w-4 h-4"
                    />
                    <label htmlFor={`agg-${condition.id}`} className="text-xs text-secondary select-none cursor-pointer">
                      Use aggregate function (HAVING)
                    </label>
                  </div>
                  
                  {/* Operator and Value */}
                  <div className="flex gap-2 items-center">
                    <select
                      value={condition.operator}
                      onChange={(e) => setWhereConditions(whereConditions.map(c => c.id === condition.id ? { ...c, operator: e.target.value } : c))}
                      className="bg-surface-secondary border border-strong rounded-md px-3 py-2.5 text-sm text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors w-24 appearance-none cursor-pointer"
                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.35rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.25em 1.25em', paddingRight: '2rem' }}
                    >
                      <option value="=">=</option>
                      <option value="!=">!=</option>
                      <option value=">">{'>'}</option>
                      <option value="<">{'<'}</option>
                      <option value=">=">{'\u2265'}</option>
                      <option value="<=">{'\u2264'}</option>
                      <option value="LIKE">LIKE</option>
                      <option value="IN">IN</option>
                    </select>
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={condition.value}
                        onChange={(e) => setWhereConditions(whereConditions.map(c => c.id === condition.id ? { ...c, value: e.target.value } : c))}
                        placeholder="Value"
                        className="w-full bg-surface-secondary border border-strong rounded-md pl-3 pr-9 py-2.5 text-sm text-primary placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                      />
                      <button
                        onClick={() => setWhereConditions(whereConditions.filter(c => c.id !== condition.id))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-red-400 transition-colors"
                        title="Remove condition"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* GROUP BY */}
            <div className="p-5 border-b border-default">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Group size={16} className="text-purple-400" />
                  GROUP BY
                </div>
                <button
                  onClick={() => setGroupBy([...groupBy, ''])}
                  className="text-blue-500 hover:text-blue-400 transition-colors p-1.5 hover:bg-blue-500/10 rounded"
                  title="Add grouping"
                >
                  <Plus size={16} />
                </button>
              </div>
              {groupBy.length === 0 && (
                <div className="text-xs text-muted italic py-2">No grouping added</div>
              )}
              {groupBy.map((col, idx) => (
                <div key={idx} className="flex gap-2 mb-3 items-center">
                  <select
                    value={col}
                    onChange={(e) => setGroupBy(groupBy.map((c, i) => i === idx ? e.target.value : c))}
                    className="flex-1 bg-surface-secondary border border-strong rounded-md px-3 py-2.5 text-sm text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                    <option value="">Select column</option>
                    {getAllColumns().map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setGroupBy(groupBy.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-2.5 rounded transition-colors shrink-0"
                    title="Remove grouping"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>

            {/* ORDER BY */}
            <div className="p-5 border-b border-default">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <SortAsc size={16} className="text-green-400" />
                  ORDER BY
                </div>
                <button
                  onClick={() => setOrderBy([...orderBy, { id: Date.now().toString(), column: '', direction: 'ASC' }])}
                  className="text-blue-500 hover:text-blue-400 transition-colors p-1.5 hover:bg-blue-500/10 rounded"
                  title="Add sorting"
                >
                  <Plus size={16} />
                </button>
              </div>
              {orderBy.length === 0 && (
                <div className="text-xs text-muted italic py-2">No sorting added</div>
              )}
              {orderBy.map((order) => (
                <div key={order.id} className="flex gap-2 mb-3 items-center">
                  <select
                    value={order.column}
                    onChange={(e) => setOrderBy(orderBy.map(o => o.id === order.id ? { ...o, column: e.target.value } : o))}
                    className="flex-1 bg-surface-secondary border border-strong rounded-md px-3 py-2.5 text-sm text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                    <option value="">Select column</option>
                    {getAllColumns().map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                  <select
                    value={order.direction}
                    onChange={(e) => setOrderBy(orderBy.map(o => o.id === order.id ? { ...o, direction: e.target.value as 'ASC' | 'DESC' } : o))}
                    className="bg-surface-secondary border border-strong rounded-md px-3 py-2.5 text-sm text-primary focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors w-28 appearance-none cursor-pointer"
                    style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/%3E%3C/svg%3E")', backgroundPosition: 'right 0.35rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.25em 1.25em', paddingRight: '2rem' }}
                  >
                    <option value="ASC">ASC ↑</option>
                    <option value="DESC">DESC ↓</option>
                  </select>
                  <button
                    onClick={() => setOrderBy(orderBy.filter(o => o.id !== order.id))}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-2.5 rounded transition-colors shrink-0"
                    title="Remove sorting"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>

            {/* LIMIT */}
            <div className="p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary mb-4">
                <Hash size={16} className="text-orange-400" />
                LIMIT
              </div>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="e.g., 100"
                min="1"
                className="w-full bg-surface-secondary border border-strong rounded-md px-3 py-2.5 text-sm text-primary placeholder-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
            </div>
          </div>
        </div>
      )}

      {/* Show Settings Button (when hidden) */}
      {!showSettings && (
        <button
          onClick={() => setShowSettings(true)}
          className="absolute top-4 right-4 z-10 bg-elevated border border-strong rounded-lg px-3 py-2 text-secondary hover:text-white hover:border-strong hover:bg-surface-secondary transition-colors shadow-xl flex items-center gap-2"
          title="Show Query Settings"
        >
          <Filter size={16} />
          <span className="text-sm font-medium">Query Settings</span>
        </button>
      )}
    </div>
  );
};

export const VisualQueryBuilder = () => (
  <ReactFlowProvider>
    <VisualQueryBuilderContent />
  </ReactFlowProvider>
);
