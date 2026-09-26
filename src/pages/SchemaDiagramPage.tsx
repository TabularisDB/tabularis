import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { SchemaDiagram } from '../components/ui/SchemaDiagram';
import { resolveDiagramSchema } from '../utils/schemaDiagram';
import { Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DatabaseProvider } from '../contexts/DatabaseProvider';
import { EditorProvider } from '../contexts/EditorProvider';

export const SchemaDiagramPage = () => {
  const { t } = useTranslation();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchParams] = useSearchParams();
  const connectionId = searchParams.get('connectionId');
  const connectionName = searchParams.get('connectionName') || 'Unknown';
  const databaseName = searchParams.get('databaseName') || 'Unknown';
  const initialSchema = searchParams.get('schema') || undefined;
  // Distinct from `databaseName` (display-only label / MySQL flat-driver
  // fallback via resolveDiagramSchema below) — set only for a schema-based
  // multi-db connection (PostgreSQL browsing several databases), where both
  // a real schema AND a database are needed to route the snapshot request.
  const database = searchParams.get('database') || undefined;

  // On a single connection that exposes multiple databases (e.g. MySQL), the
  // diagram must be scoped to the selected database rather than the connection's
  // primary one. See resolveDiagramSchema for the full rationale.
  const effectiveSchema = resolveDiagramSchema(initialSchema, databaseName);

  // Schema picker is only meaningful for schema-based drivers (Postgres) —
  // identified by the presence of an explicit `schema` URL param. MySQL's
  // "schema" is actually the database name (flat, no schema concept), so
  // showing a schema switcher there would be misleading.
  const isSchemaCapable = !!initialSchema;

  const [selectedSchema, setSelectedSchema] = useState<string | undefined>(effectiveSchema);
  const [availableSchemas, setAvailableSchemas] = useState<string[]>(
    effectiveSchema ? [effectiveSchema] : [],
  );
  const [loadingSchemas, setLoadingSchemas] = useState(false);

  const fetchSchemas = useCallback(async () => {
    if (!connectionId || !isSchemaCapable) return;
    setLoadingSchemas(true);
    try {
      const schemas = await invoke<string[]>('get_schemas', {
        connectionId,
        ...(database ? { database } : {}),
      });
      setAvailableSchemas(schemas);
    } catch (e) {
      console.error('Failed to fetch schemas for ER diagram picker:', e);
    } finally {
      setLoadingSchemas(false);
    }
  }, [connectionId, isSchemaCapable, database]);

  useEffect(() => {
    fetchSchemas();
  }, [fetchSchemas]);

  const handleSchemaChange = (schema: string) => {
    setSelectedSchema(schema);
    setRefreshTrigger(prev => prev + 1);
  };

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
            {t('erDiagram.noConnection')}
          </h1>
          <p className="text-secondary">
            {t('erDiagram.noConnectionDesc')}
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
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-primary font-semibold truncate">
                {databaseName} ({connectionName})
              </h1>
              {isSchemaCapable && availableSchemas.length > 0 && (
                <select
                  value={selectedSchema ?? ""}
                  onChange={(e) => handleSchemaChange(e.target.value)}
                  disabled={loadingSchemas}
                  className="px-2 py-1 bg-surface-secondary border border-strong rounded text-sm text-primary focus:outline-none focus:border-focus disabled:opacity-50 max-w-[180px] truncate"
                  title={t('sidebar.schemas')}
                >
                  {availableSchemas.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary hover:bg-surface-tertiary text-primary rounded-lg border border-strong transition-colors text-sm"
                title={t('sidebar.refresh')}
              >
                <RefreshCw size={16} />
                {t('sidebar.refresh')}
              </button>
              <button
                onClick={toggleFullscreen}
                className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary hover:bg-surface-tertiary text-primary rounded-lg border border-strong transition-colors text-sm"
                title={isFullscreen ? t('erDiagram.exitFullscreen') : t('erDiagram.enterFullscreen')}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 size={16} />
                    {t('erDiagram.exitFullscreen')}
                  </>
                ) : (
                  <>
                    <Maximize2 size={16} />
                    {t('erDiagram.enterFullscreen')}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Diagram Canvas */}
          <div className="flex-1 overflow-hidden">
            <SchemaDiagram
              connectionId={connectionId}
              refreshTrigger={refreshTrigger}
              schema={selectedSchema}
              database={database}
            />
          </div>
        </div>
      </EditorProvider>
    </DatabaseProvider>
  );
};
