import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Loader2,
  Network,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../../hooks/useTheme";
import { useSettings } from "../../hooks/useSettings";
import { useDatabase } from "../../hooks/useDatabase";
import { useDrivers } from "../../hooks/useDrivers";
import MonacoEditor from "@monaco-editor/react";
import type { ExplainPlan } from "../../types/explain";
import {
  findExplainNode,
  isDataModifyingQuery,
} from "../../utils/explainPlan";
import { isExplainableQuery } from "../../utils/sql";
import { getDriverIcon } from "../../utils/driverUI";
import {
  ExplainSummaryBar,
  type ExplainViewMode,
} from "./visual-explain/ExplainSummaryBar";
import { ExplainGraph } from "./visual-explain/ExplainGraph";
import { ExplainTableView } from "./visual-explain/ExplainTableView";
import { ExplainAiAnalysis } from "./visual-explain/ExplainAiAnalysis";
import { ExplainNodeDetails } from "./visual-explain/ExplainNodeDetails";
import { ExplainOverviewBar } from "./visual-explain/ExplainOverviewBar";

interface VisualExplainModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  connectionId: string;
  schema?: string;
}

export const VisualExplainModal = ({
  isOpen,
  onClose,
  query,
  connectionId,
  schema,
}: VisualExplainModalProps) => {
  const { t } = useTranslation();
  const { currentTheme } = useTheme();
  const { settings } = useSettings();
  const { getConnectionData } = useDatabase();
  const { allDrivers } = useDrivers();
  const [plan, setPlan] = useState<ExplainPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ExplainViewMode>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const isDml = query ? isDataModifyingQuery(query) : false;
  const [analyze, setAnalyze] = useState(!isDml);
  const connectionData = getConnectionData(connectionId);
  const effectiveDriver =
    connectionData?.driver ?? plan?.driver ?? "sqlite";
  const driverManifest =
    allDrivers.find((driver) => driver.id === effectiveDriver) ?? null;
  const driverLabel = driverManifest?.name ?? effectiveDriver;
  const connectionLabel = connectionData?.connectionName ?? connectionId;
  const schemaLabel = schema ?? connectionData?.activeSchema ?? null;
  const databaseLabel = connectionData?.databaseName ?? schema ?? "";
  const locationLabel =
    schemaLabel && schemaLabel !== databaseLabel
      ? `${databaseLabel} / ${schemaLabel}`
      : databaseLabel;

  const selectedNode = useMemo(
    () => (plan ? findExplainNode(plan.root, selectedNodeId) : null),
    [plan, selectedNodeId],
  );
  const rawLanguage = useMemo(() => {
    if (!plan?.raw_output) {
      return "plaintext";
    }

    const trimmed = plan.raw_output.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return "json";
    }

    return "plaintext";
  }, [plan]);

  const handleExplain = useCallback(async () => {
    if (!query?.trim() || !connectionId) return;

    if (!isExplainableQuery(query)) {
      setError(t("editor.visualExplain.notExplainable"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setPlan(null);

    try {
      const result = await invoke<ExplainPlan>("explain_query_plan", {
        connectionId,
        query,
        analyze,
        schema: schema || null,
      });
      setPlan(result);
      setSelectedNodeId(result.root.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [query, connectionId, analyze, schema, t]);

  useEffect(() => {
    if (isOpen && query?.trim() && connectionId) {
      setViewMode("graph");
      handleExplain();
    }
  }, [isOpen, query, connectionId, handleExplain]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[90vw] h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-default bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-900/30 rounded-lg">
              <Network size={20} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">
                {t("editor.visualExplain.title")}
              </h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <div className="inline-flex items-center gap-2 rounded-lg border border-default bg-surface-secondary/50 px-2.5 py-1 text-xs text-secondary">
                  <span className="text-primary">{getDriverIcon(driverManifest, 14)}</span>
                  <span className="font-medium text-primary">
                    {connectionLabel}
                  </span>
                </div>
                {locationLabel && (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-default bg-base/70 px-2.5 py-1 text-xs text-secondary">
                    <span className="uppercase tracking-wide text-muted">
                      {driverLabel}
                    </span>
                    <span className="text-muted">•</span>
                    <span className="font-mono">{locationLabel}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Summary Bar */}
        <ExplainSummaryBar
          plan={plan}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          aiEnabled={!!settings.aiEnabled}
        />
        {plan && (
          <ExplainOverviewBar
            plan={plan}
            onSelectNode={setSelectedNodeId}
          />
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden min-h-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted">
              <Loader2 size={24} className="animate-spin" />
              <span className="text-sm">
                {t("editor.visualExplain.loading")}
              </span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 px-8">
              <div className="text-error-text text-sm text-center max-w-lg">
                {error}
              </div>
            </div>
          ) : plan ? (
            viewMode === "raw" && plan.raw_output ? (
              <MonacoEditor
                height="100%"
                language={rawLanguage}
                theme={currentTheme.id}
                value={plan.raw_output}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  wordWrap: "on",
                }}
              />
            ) : viewMode === "ai" ? (
              <ExplainAiAnalysis plan={plan} />
            ) : viewMode === "table" ? (
              <ExplainTableView
                plan={plan}
                selectedId={selectedNodeId}
                onSelect={setSelectedNodeId}
              />
            ) : (
              <div className="flex h-full">
                <div className="flex-1 min-w-0 border-r border-default">
                  <ExplainGraph
                    plan={plan}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={setSelectedNodeId}
                  />
                </div>
                <div className="w-[320px] shrink-0 overflow-y-auto bg-base/50">
                  <ExplainNodeDetails
                    node={selectedNode}
                    hasAnalyzeData={plan.has_analyze_data}
                  />
                </div>
              </div>
            )
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-default bg-base/50 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={analyze}
              onChange={(e) => setAnalyze(e.target.checked)}
              className="rounded border-strong"
            />
            {t("editor.visualExplain.analyze")}
          </label>

          {isDml && (
            <div className="flex items-center gap-1.5 text-xs text-warning-text">
              <AlertTriangle size={12} />
              <span>{t("editor.visualExplain.analyzeWarning")}</span>
            </div>
          )}

          <div className="flex-1" />

          <button
            onClick={handleExplain}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            {t("editor.visualExplain.rerun")}
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
          >
            {t("editor.visualExplain.close")}
          </button>
        </div>
      </div>
    </div>
  );
};
