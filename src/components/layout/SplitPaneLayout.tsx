import { useMemo, useRef, useState } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { PanelDatabaseProvider } from './PanelDatabaseProvider';
import { EditorProvider } from '../../contexts/EditorProvider';
import { Editor } from '../../pages/Editor';
import { useConnectionLayoutContext } from '../../hooks/useConnectionLayoutContext';
import { useDatabase } from '../../hooks/useDatabase';
import { useDrivers } from '../../hooks/useDrivers';
import { getConnectionAccent } from '../../utils/driverUI';
import {
  computeLayoutGeometry,
  getPanelDropEdge,
  getSplitNodeAt,
  resizeSplitSizes,
} from '../../utils/connectionLayout';
import type { DividerGeometry, SplitEdge, SplitView } from '../../utils/connectionLayout';
import { rectContains, startPointerDrag } from '../../utils/pointerDrag';

const EDGE_OVERLAY_CLASS: Record<SplitEdge, string> = {
  left: 'left-0 top-0 bottom-0 w-1/2',
  right: 'right-0 top-0 bottom-0 w-1/2',
  top: 'top-0 left-0 right-0 h-1/2',
  bottom: 'bottom-0 left-0 right-0 h-1/2',
};

/**
 * Renders the split view as a tiling layout: pane and divider rectangles are
 * computed from the layout tree and applied as absolute percent positions.
 * Panels are rendered in a stable order and never nested in per-split
 * containers, so their DOM nodes survive any rearrangement (Monaco crashes
 * when its container is reparented mid-render).
 */
export const SplitPaneLayout = ({ layout, connectionIds }: SplitView) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    deactivateSplit,
    removeConnectionFromSplit,
    moveSplitConnection,
    resizeSplitNode,
    explorerConnectionId,
    setExplorerConnectionId,
  } = useConnectionLayoutContext();
  const { switchConnection, connectionDataMap, connections } = useDatabase();
  const { allDrivers } = useDrivers();
  const { t } = useTranslation();

  const [draggedPanelId, setDraggedPanelId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ connId: string; edge: SplitEdge } | null>(null);
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const dropTargetRef = useRef<{ connId: string; edge: SplitEdge } | null>(null);

  const geometry = useMemo(() => computeLayoutGeometry(layout), [layout]);
  const paneRects = useMemo(
    () => new Map(geometry.panes.map(p => [p.connectionId, p.rect])),
    [geometry],
  );
  // Stable render order: rearrangements only change style attributes
  const stableIds = useMemo(() => [...connectionIds].sort(), [connectionIds]);

  const accentFor = (connId: string) => {
    const conn = connections.find((c) => c.id === connId);
    const driverId = conn?.params.driver ?? connectionDataMap[connId]?.driver;
    return getConnectionAccent(conn, allDrivers.find((d) => d.id === driverId));
  };

  const handleClosePanel = (connId: string) => {
    const remaining = connectionIds.filter(id => id !== connId);
    if (remaining.length < 2) {
      deactivateSplit();
      if (remaining.length === 1) switchConnection(remaining[0]);
    } else {
      removeConnectionFromSplit(connId);
      if (explorerConnectionId === connId) {
        setExplorerConnectionId(remaining[0]);
      }
    }
  };

  // Pointer-based panel move: drag the grip onto another panel's edge to
  // re-tile it there (HTML5 DnD can freeze the WebKitGTK compositor)
  const startPanelMove = (connId: string, connName: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startPointerDrag(e.clientX, e.clientY, {
      createGhost: () => {
        const ghost = document.createElement('div');
        ghost.className = 'px-2 py-1 rounded text-xs bg-surface-secondary text-primary border border-default shadow-lg';
        ghost.textContent = connName;
        return ghost;
      },
      onDragStart: () => setDraggedPanelId(connId),
      onDragMove: (x, y) => {
        let found: { connId: string; edge: SplitEdge } | null = null;
        for (const [id, el] of panelRefs.current) {
          if (id === connId) continue;
          const rect = el.getBoundingClientRect();
          if (rectContains(rect, x, y)) {
            found = { connId: id, edge: getPanelDropEdge(rect, x, y) };
            break;
          }
        }
        dropTargetRef.current = found;
        setDropTarget(prev =>
          prev?.connId === found?.connId && prev?.edge === found?.edge ? prev : found,
        );
      },
      onDrop: () => {
        const target = dropTargetRef.current;
        if (target) moveSplitConnection(connId, target.connId, target.edge);
      },
      onEnd: () => {
        dropTargetRef.current = null;
        setDraggedPanelId(null);
        setDropTarget(null);
      },
    });
  };

  // Divider drag: adjusts the shares of the split node the divider belongs
  // to, measured against that node's own extent
  const startDividerResize = (divider: DividerGeometry, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const container = containerRef.current;
    const node = getSplitNodeAt(layout, divider.path);
    if (!container || !node || node.type !== 'split') return;

    const containerRect = container.getBoundingClientRect();
    const isVertical = divider.mode === 'vertical';
    const nodePx =
      ((isVertical ? containerRect.width : containerRect.height) * divider.nodeMainSize) / 100;
    if (nodePx <= 0) return;
    const startPos = isVertical ? e.clientX : e.clientY;
    const startSizes = node.sizes;

    startPointerDrag(e.clientX, e.clientY, {
      threshold: 0,
      cursor: isVertical ? 'col-resize' : 'row-resize',
      onDragMove: (x, y) => {
        const deltaPercent = (((isVertical ? x : y) - startPos) / nodePx) * 100;
        resizeSplitNode(divider.path, resizeSplitSizes(startSizes, divider.index, deltaPercent));
      },
    });
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {stableIds.map((connId) => {
        const rect = paneRects.get(connId);
        if (!rect) return null;
        const accent = accentFor(connId);
        const isActivePanel = explorerConnectionId === connId;
        const isDropCandidate = !!draggedPanelId && draggedPanelId !== connId;
        return (
          <div
            key={connId}
            ref={(el) => {
              if (el) panelRefs.current.set(connId, el);
              else panelRefs.current.delete(connId);
            }}
            className="absolute flex flex-col min-w-0 min-h-0"
            onClickCapture={() => {
              if (explorerConnectionId !== connId) setExplorerConnectionId(connId);
            }}
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
            }}
          >
            {/* Drop-zone highlight while dragging a panel over this one */}
            {isDropCandidate && dropTarget?.connId === connId && (
              <div
                className={clsx(
                  'absolute z-20 pointer-events-none bg-blue-500/20 border-2 border-blue-400/60 rounded-sm',
                  EDGE_OVERLAY_CLASS[dropTarget.edge],
                )}
              />
            )}

            {/* Panel header — same accent wash as the editor tab bar below,
                with the connection's accent color for the title text. */}
            <div
              className="flex items-center justify-between h-7 px-3 border-b shrink-0 transition-colors"
              style={{
                backgroundImage: isActivePanel
                  ? `linear-gradient(${accent}30, ${accent}20)`
                  : `linear-gradient(${accent}18, ${accent}10)`,
                borderBottomColor: `${accent}${isActivePanel ? '50' : '26'}`,
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <div
                  onMouseDown={(e) => startPanelMove(connId, connectionDataMap[connId]?.connectionName ?? connId, e)}
                  className="shrink-0 cursor-grab active:cursor-grabbing text-muted hover:text-primary"
                  title={t('sidebar.movePanel')}
                >
                  <GripHorizontal size={12} />
                </div>
                <span
                  className="text-xs truncate transition-colors"
                  style={{ color: `${accent}${isActivePanel ? 'ff' : 'b3'}` }}
                >
                  {connectionDataMap[connId]?.connectionName ?? connId}
                </span>
              </div>
              <button
                onClick={() => handleClosePanel(connId)}
                className="ml-2 p-0.5 rounded text-muted hover:text-primary hover:bg-surface-secondary transition-colors shrink-0"
                title={t('sidebar.closePanel')}
              >
                <X size={12} />
              </button>
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-hidden min-h-0">
              <PanelDatabaseProvider connectionId={connId}>
                <EditorProvider>
                  <Editor />
                </EditorProvider>
              </PanelDatabaseProvider>
            </div>
          </div>
        );
      })}

      {/* Dividers overlay the pane boundaries */}
      {geometry.dividers.map((divider) => (
        <div
          key={`${divider.path.join('.')}:${divider.index}`}
          onMouseDown={(e) => startDividerResize(divider, e)}
          className={clsx(
            'absolute bg-default hover:bg-blue-500/50 transition-colors z-10',
            divider.mode === 'vertical' ? 'cursor-col-resize' : 'cursor-row-resize',
          )}
          style={
            divider.mode === 'vertical'
              ? {
                  left: `calc(${divider.pos}% - 2px)`,
                  top: `${divider.crossStart}%`,
                  width: '4px',
                  height: `${divider.crossSize}%`,
                }
              : {
                  top: `calc(${divider.pos}% - 2px)`,
                  left: `${divider.crossStart}%`,
                  height: '4px',
                  width: `${divider.crossSize}%`,
                }
          }
        />
      ))}
    </div>
  );
};
