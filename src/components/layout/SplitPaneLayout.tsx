import { useRef, Fragment } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { PanelDatabaseProvider } from './PanelDatabaseProvider';
import { EditorProvider } from '../../contexts/EditorProvider';
import { Editor } from '../../pages/Editor';
import { useSplitPaneResize } from '../../hooks/useSplitPaneResize';
import { useConnectionLayoutContext } from '../../hooks/useConnectionLayoutContext';
import { useDatabase } from '../../hooks/useDatabase';
import { useDrivers } from '../../hooks/useDrivers';
import { getConnectionAccent } from '../../utils/driverUI';
import type { SplitView } from '../../utils/connectionLayout';

export const SplitPaneLayout = ({ connectionIds, mode }: SplitView) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { splitRatio, startResize } = useSplitPaneResize(mode, containerRef);
  const isVertical = mode === 'vertical';
  const { deactivateSplit, removeConnectionFromSplit, explorerConnectionId, setExplorerConnectionId } = useConnectionLayoutContext();
  const { switchConnection, connectionDataMap, connections } = useDatabase();
  const { allDrivers } = useDrivers();
  const { t } = useTranslation();

  // Each panel header carries its own connection's accent color (matching the
  // tinted editor tab bar inside the panel), with the active panel rendered
  // more strongly so it still stands out from the others.
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

  return (
    <div
      ref={containerRef}
      className={clsx('flex h-full w-full', isVertical ? 'flex-row' : 'flex-col')}
    >
      {connectionIds.map((connId, i) => {
        const accent = accentFor(connId);
        const isActivePanel = explorerConnectionId === connId;
        return (
        <Fragment key={connId}>
          <div
            className="flex flex-col min-w-0 min-h-0"
            onClickCapture={() => {
              if (explorerConnectionId !== connId) setExplorerConnectionId(connId);
            }}
            style={
              i === 0
                ? {
                    [isVertical ? 'width' : 'height']: `${splitRatio}%`,
                    flexShrink: 0,
                  }
                : { flex: 1 }
            }
          >
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
              <span
                className="text-xs truncate transition-colors"
                style={{ color: `${accent}${isActivePanel ? 'ff' : 'b3'}` }}
              >
                {connectionDataMap[connId]?.connectionName ?? connId}
              </span>
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

          {i < connectionIds.length - 1 && (
            <div
              onMouseDown={startResize}
              className={clsx(
                'bg-default hover:bg-blue-500/50 transition-colors shrink-0 z-10',
                isVertical ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
              )}
            />
          )}
        </Fragment>
        );
      })}
    </div>
  );
};
