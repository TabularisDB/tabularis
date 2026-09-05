import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Maximize2, AlertTriangle } from "lucide-react";
import { useDatabase } from "../../hooks/useDatabase";
import { useSettings } from "../../hooks/useSettings";
import { useExplainPlan } from "../../hooks/useExplainPlan";
import { supportsExplain } from "../../utils/driverCapabilities";
import { isDataModifyingQuery } from "../../utils/sql";
import { VisualExplainView } from "../explain/VisualExplainView";
import { VisualExplainModal } from "../modals/VisualExplainModal";
import { CellSectionHeader } from "./CellSectionHeader";
import { ResizeHandle } from "./ResizeHandle";

interface SqlCellExplainProps {
  query: string;
  connectionId: string;
  schema?: string;
  visible: boolean;
  onToggleVisible: () => void;
}

export function SqlCellExplain({
  query,
  connectionId,
  schema,
  visible,
  onToggleVisible,
}: SqlCellExplainProps) {
  const { t } = useTranslation();
  const { activeCapabilities } = useDatabase();
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
  const isDml = query ? isDataModifyingQuery(query) : false;
  const [analyze, setAnalyze] = useState(!isDml);
  const [height, setHeight] = useState(720);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const explain = useCallback(
    (useAnalyze: boolean) =>
      runExplain({ connectionId, query, analyze: useAnalyze, schema }),
    [runExplain, connectionId, query, schema],
  );

  useEffect(() => {
    if (visible && !plan && !isLoading && !error) explain(analyze);
  }, [visible, plan, isLoading, error, analyze, explain]);

  if (!supportsExplain(activeCapabilities) || !visible) return null;

  const handleToggleAnalyze = (checked: boolean) => {
    setAnalyze(checked);
    explain(checked);
  };

  const canRun = !!query.trim() && !!connectionId;

  return (
    <>
      <CellSectionHeader
        label={t("editor.notebook.sectionQueryPlan")}
        collapsed={false}
        onToggle={onToggleVisible}
      >
        <label
          className="flex items-center gap-1 cursor-pointer"
          title={isDml ? t("editor.visualExplain.analyzeWarning") : undefined}
        >
          <input
            type="checkbox"
            checked={analyze}
            onChange={(e) => handleToggleAnalyze(e.target.checked)}
            className="rounded border-strong"
          />
          {t("editor.visualExplain.analyze")}
        </label>
        {isDml && analyze && (
          <AlertTriangle size={12} className="text-warning-text" />
        )}
        <button
          type="button"
          onClick={() => explain(analyze)}
          disabled={isLoading || !canRun}
          title={t("editor.visualExplain.rerun")}
          className="p-1 text-muted hover:text-secondary hover:bg-surface-secondary rounded transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
        </button>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          disabled={!canRun}
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
        <VisualExplainView
          plan={plan}
          isLoading={isLoading}
          error={error}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          aiEnabled={!!settings.aiEnabled}
        />
      </div>
      <ResizeHandle onResize={setHeight} minHeight={200} maxHeight={1200} />
      <VisualExplainModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        query={query}
        connectionId={connectionId}
        schema={schema}
      />
    </>
  );
}
