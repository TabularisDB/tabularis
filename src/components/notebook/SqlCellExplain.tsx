import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Maximize2, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { ExplainPlan, ExplainQueryOutput } from "@tabularis/explain";
import { resolveExplainOutput } from "@tabularis/explain";
import type { ExplainViewMode } from "@tabularis/explain/react";
import { useDatabase } from "../../hooks/useDatabase";
import { useSettings } from "../../hooks/useSettings";
import { supportsExplain } from "../../utils/driverCapabilities";
import { isDataModifyingQuery, isExplainableQuery } from "../../utils/sql";
import { VisualExplainView } from "../explain/VisualExplainView";
import { VisualExplainModal } from "../modals/VisualExplainModal";
import { CellSectionHeader } from "./CellSectionHeader";
import { ResizeHandle } from "./ResizeHandle";

interface SqlCellExplainProps {
  query: string;
  connectionId: string;
  schema?: string;
  /** Whether the query plan section is shown; controlled by the cell toolbar. */
  visible: boolean;
  /** Toggles the section from its own collapse chevron. */
  onToggleVisible: () => void;
}

/**
 * Inline "Query Plan" section for a SQL cell. Renders the visual explain view
 * directly below the results (EXPLAIN / EXPLAIN ANALYZE), plus a popout to the
 * full modal. Hidden until enabled from the cell toolbar; available whenever the
 * driver supports EXPLAIN, independent of the AI setting.
 */
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
  const [plan, setPlan] = useState<ExplainPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ExplainViewMode>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const isDml = query ? isDataModifyingQuery(query) : false;
  const [analyze, setAnalyze] = useState(!isDml);
  const [height, setHeight] = useState(720);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const runExplain = useCallback(
    async (useAnalyze: boolean) => {
      if (!query?.trim() || !connectionId) return;
      if (!isExplainableQuery(query)) {
        setPlan(null);
        setError(t("editor.visualExplain.notExplainable"));
        return;
      }
      setIsLoading(true);
      setError(null);
      setPlan(null);
      try {
        const result = await invoke<ExplainQueryOutput>("explain_query_plan", {
          connectionId,
          query,
          analyze: useAnalyze,
          schema: schema || null,
        });
        const parsed = resolveExplainOutput(result);
        setPlan(parsed);
        setSelectedNodeId(parsed.root.id);
      } catch (err) {
        setError(String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [query, connectionId, schema, t],
  );

  // Run EXPLAIN automatically the first time the section is shown so the plan
  // appears immediately; the guards keep it from re-running while loading or
  // once a plan/error already exists.
  useEffect(() => {
    if (visible && !plan && !isLoading && !error) {
      runExplain(analyze);
    }
  }, [visible, plan, isLoading, error, analyze, runExplain]);

  if (!supportsExplain(activeCapabilities) || !visible) return null;

  const handleToggleAnalyze = (checked: boolean) => {
    setAnalyze(checked);
    runExplain(checked);
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
          onClick={() => runExplain(analyze)}
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
