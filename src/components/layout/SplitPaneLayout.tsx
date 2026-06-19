import { useRef, Fragment } from 'react';
import { X } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';
import clsx from 'clsx';
import { PanelDatabaseProvider } from './PanelDatabaseProvider';
import { EditorProvider } from '../../contexts/EditorProvider';
import { Editor } from '../../pages/Editor';
import { useSplitPaneResize } from '../../hooks/useSplitPaneResize';
import { useConnectionLayoutContext } from '../../hooks/useConnectionLayoutContext';
import { useDatabase } from '../../hooks/useDatabase';
import type { SplitView } from '../../utils/connectionLayout';

export const SplitPaneLayout = ({ connectionIds, mode }: SplitView) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { splitRatio, startResize } = useSplitPaneResize(mode, containerRef);
  const isVertical = mode === 'vertical';
  const { deactivateSplit, removeConnectionFromSplit, explorerConnectionId, setExplorerConnectionId } = useConnectionLayoutContext();
  const { switchConnection, connectionDataMap } = useDatabase();
  const { t } = useLingui();

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
      {connectionIds.map((connId, i) => (
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
            {/* Panel header */}
            <div className={clsx(
              'flex items-center justify-between h-7 px-3 border-b shrink-0 transition-colors',
              explorerConnectionId === connId
                ? 'bg-blue-500/10 border-blue-500/30'
                : 'bg-elevated border-default',
            )}>
              <span className={clsx(
                'text-xs truncate transition-colors',
                explorerConnectionId === connId ? 'text-blue-400' : 'text-muted',
              )}>
                {connectionDataMap[connId]?.connectionName ?? connId}
              </span>
              <button
                onClick={() => handleClosePanel(connId)}
                className="ml-2 p-0.5 rounded text-muted hover:text-primary hover:bg-surface-secondary transition-colors shrink-0"
                title={t`Close panel`}
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
      ))}
    </div>
  );
};
