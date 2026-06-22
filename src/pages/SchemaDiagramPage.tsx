import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SchemaDiagram } from '../components/ui/SchemaDiagram';
import { Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';
import { DatabaseProvider } from '../contexts/DatabaseProvider';
import { EditorProvider } from '../contexts/EditorProvider';

export const SchemaDiagramPage = () => {
  const { t } = useLingui();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchParams] = useSearchParams();
  const connectionId = searchParams.get('connectionId');
  const connectionName = searchParams.get('connectionName') || 'Unknown';
  const databaseName = searchParams.get('databaseName') || 'Unknown';
  const schema = searchParams.get('schema') || undefined;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Listen for fullscreen changes (e.g., ESC key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Show error if no connectionId
  if (!connectionId) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-base">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-primary mb-2">
            {t`No Connection ID`}
          </h1>
          <p className="text-secondary">
            {t`Cannot display diagram without a connection ID.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <DatabaseProvider>
      <EditorProvider>
        <div className="w-screen h-screen flex flex-col bg-base">
          {/* Minimal Header */}
          <div className="h-12 bg-elevated border-b border-default flex items-center justify-between px-4 shrink-0">
            <h1 className="text-primary font-semibold">
              {databaseName}{schema ? ` / ${schema}` : ''} ({connectionName})
            </h1>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary hover:bg-surface-tertiary text-primary rounded-lg border border-strong transition-colors text-sm"
                title={t`Refresh`}
              >
                <RefreshCw size={16} />
                {t`Refresh`}
              </button>
              <button
                onClick={toggleFullscreen}
                className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary hover:bg-surface-tertiary text-primary rounded-lg border border-strong transition-colors text-sm"
                title={isFullscreen ? t`Exit Fullscreen` : t`Fullscreen`}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 size={16} />
                    {t`Exit Fullscreen`}
                  </>
                ) : (
                  <>
                    <Maximize2 size={16} />
                    {t`Fullscreen`}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Diagram Canvas */}
          <div className="flex-1 overflow-hidden">
            <SchemaDiagram connectionId={connectionId} refreshTrigger={refreshTrigger} schema={schema} />
          </div>
        </div>
      </EditorProvider>
    </DatabaseProvider>
  );
};
