import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Maximize2, AlertTriangle } from "lucide-react";
import { useDatabase } from "../../hooks/useDatabase";
import { useSettings } from "../../hooks/useSettings";
import { useExplainPlan } from "../../hooks/useExplainPlan";
import { useExplainAnalyze } from "../../hooks/useExplainAnalyze";
import { supportsExplain } from "../../utils/driverCapabilities";
import { VisualExplainView, type VisualExplainViewProps } from "../explain/VisualExplainView";
import { VisualExplainModal } from "../modals/VisualExplainModal";
import { CellSectionHeader } from "./CellSectionHeader";
import { ResizeHandle } from "./ResizeHandle";

interface SqlCellExplainProps {
  query: string;
  connectionId: string;
  schema?: string;
  queryError?: string;
  visible: boolean;
  onToggleVisible: () => void;
}

export function SqlCellExplain({
  query,
  connectionId,
  schema,
  queryError,
  visible,
  onToggleVisible,
}: SqlCellExplainProps) {
  const { t } = useTranslation();
  const { getConnectionData } = useDatabase();
  const canExplain = supportsExplain(getConnectionData(connectionId)?.capabilities);
  const { settings } = useSettings();
  const {
    plan,
    isLoading,
    error,
    viewMode,
    setViewMode,
    selectedNodeId,
    setSelectedNodeId,
    runExplain,
  } = useExplainPlan();
  const { sourceKey, analyze, setAnalyze, isDml } = useExplainAnalyze({ connectionId, query, schema });
  const [requestedSource, setRequestedSource] = useState<string | null>(null);
  const autoStarted = useRef(false);
  const [height, setHeight] = useState(720);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const canRun = canExplain && !!query.trim() && !!connectionId && !queryError;

  const explain = useCallback(
    (useAnalyze: boolean) => {
      if (!canRun) return;
      setRequestedSource(sourceKey);
      return runExplain({ connectionId, query, analyze: useAnalyze, schema });
    },
    [canRun, sourceKey, runExplain, connectionId, query, schema],
  );

  useEffect(() => {
    if (!visible || !canRun || autoStarted.current) return;
    let cancelled = false;
    const start = async () => {
      await Promise.resolve();
      if (cancelled || autoStarted.current) return;
      autoStarted.current = true;
      await explain(false);
    };
    void start();
    return () => { cancelled = true; };
  }, [visible, canRun, explain]);

  if (!canExplain || !visible) return null;

  const isCurrent = requestedSource === sourceKey;
  const viewState: VisualExplainViewProps = {
    plan: isCurrent && !queryError ? plan : null,
    isLoading: isCurrent && !queryError && isLoading,
    error: queryError || (isCurrent ? error : requestedSource
      ? t("editor.notebook.queryPlanOutdated") : null),
    viewMode,
    onViewModeChange: setViewMode,
    selectedNodeId: isCurrent ? selectedNodeId : null,
    onSelectNode: setSelectedNodeId,
    aiEnabled: !!settings.aiEnabled,
  };

  return (
    <>
      <CellSectionHeader
        label={t("editor.notebook.sectionQueryPlan")}
        collapsed={false}
        onToggle={onToggleVisible}
      >
        <label
          className="flex items-center gap-1 cursor-pointer"
          title={t("editor.visualExplain.analyzeWarning")}
        >
          <input
            type="checkbox"
            checked={analyze}
            onChange={(e) => setAnalyze(e.target.checked)}
            disabled={viewState.isLoading || !canRun}
            className="rounded border-strong"
          />
          {t("editor.visualExplain.analyze")}
        </label>
        {isDml && analyze && (
          <span className="flex items-center gap-1 text-warning-text" role="status">
            <AlertTriangle size={12} />
            {t("editor.visualExplain.analyzeWarning")}
          </span>
        )}
        <button
          type="button"
          onClick={() => explain(analyze)}
          disabled={viewState.isLoading || !canRun}
          title={t("editor.visualExplain.rerun")}
          className="p-1 text-muted hover:text-secondary hover:bg-surface-secondary rounded transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <RefreshCw size={12} className={viewState.isLoading ? "animate-spin" : ""} />
        </button>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          disabled={!viewState.plan || viewState.isLoading}
          title={t("editor.notebook.explainPopout")}
          className="p-1 text-muted hover:text-secondary hover:bg-surface-secondary rounded transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <Maximize2 size={12} />
        </button>
      </CellSectionHeader>
      <div
        style={{ height }}
        className="flex flex-col overflow-hidden border-t border-default"
      >
        <VisualExplainView {...viewState} />
      </div>
      <ResizeHandle onResize={setHeight} minHeight={200} maxHeight={1200} />
      <VisualExplainModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        query={query}
        connectionId={connectionId}
        schema={schema}
        viewState={viewState}
      />
    </>
  );
}
