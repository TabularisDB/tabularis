import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { SchemaDiagram } from '../components/ui/SchemaDiagram';
import { Select } from '../components/ui/Select';
import { resolveDiagramSchema } from '../utils/schemaDiagram';
import { resolveActiveSchema } from '../utils/schema';
import { Layers, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
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
  const schema = searchParams.get('schema') || undefined;
  // Schema-based multi-database (PostgreSQL): the database the schema lives in,
  // so the diagram's metadata fetch routes to the right connection pool.
  const database = searchParams.get('database') || undefined;
  // Schema-based driver (PostgreSQL): the opener sets this flag so the page —
  // which runs in its own window without the opener's capability context —
  // knows it can offer a schema picker.
  const isSchemaBased = searchParams.get('schemaBased') === '1';

  // Schema picker (schema-based drivers only): list the target database's
  // schemas and let the user re-scope the diagram without reopening it.
  const [availableSchemas, setAvailableSchemas] = useState<string[]>([]);
  const [pickedSchema, setPickedSchema] = useState<string | null>(schema ?? null);
  useEffect(() => {
    if (!isSchemaBased || !connectionId) return;
    let cancelled = false;
    invoke<string[]>('get_schemas', {
      connectionId,
      ...(database ? { database } : {}),
    })
      .then((schemas) => {
        if (cancelled) return;
        setAvailableSchemas(schemas);
        // Keep the URL's schema when valid, otherwise fall back sensibly
        // ("public" or the first schema) so the diagram is never empty.
        setPickedSchema((prev) => resolveActiveSchema(prev, schema, schemas));
      })
      .catch((e) => console.error('Failed to load schemas for diagram:', e));
    return () => {
      cancelled = true;
    };
  }, [isSchemaBased, connectionId, database, schema]);

  // On a single connection that exposes multiple databases (e.g. MySQL), the
  // diagram must be scoped to the selected database rather than the connection's
  // primary one. See resolveDiagramSchema for the full rationale.
  //
  // When the driver is schema-based (PostgreSQL), the picker owns the schema
  // and `databaseName` must NOT be reused as a schema fallback — it is a
  // database name, and treating it as a schema would set search_path to a
  // non-existent schema.
  const effectiveSchema = isSchemaBased
    ? (pickedSchema ?? schema)
    : database
      ? schema
      : resolveDiagramSchema(schema, databaseName);

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
            <h1 className="text-primary font-semibold">
              {databaseName}
              {!isSchemaBased && schema ? ` / ${schema}` : ''}
              {isSchemaBased && effectiveSchema ? ` / ${effectiveSchema}` : ''}
              {` (${connectionName})`}
            </h1>
            <div className="flex items-center gap-2">
              {/* Schema picker (schema-based drivers, i.e. PostgreSQL): re-scope
                  the diagram to another schema without reopening the window. */}
              {isSchemaBased && availableSchemas.length > 0 && (
                <Select
                  value={effectiveSchema ?? null}
                  options={availableSchemas}
                  onChange={(s) => setPickedSchema(s)}
                  placeholder={t('sidebar.schema')}
                  className="w-44"
                  triggerClassName="px-3 py-1.5 text-sm"
                  leadingIcon={<Layers size={14} className="text-accent shrink-0" />}
                />
              )}
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
            <SchemaDiagram connectionId={connectionId} refreshTrigger={refreshTrigger} schema={effectiveSchema} database={database} />
          </div>
        </div>
      </EditorProvider>
    </DatabaseProvider>
  );
};
