import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { X, Loader2, Network, RefreshCw, AlertTriangle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../../hooks/useTheme";
import { useSettings } from "../../hooks/useSettings";
import MonacoEditor from "@monaco-editor/react";
import type { ExplainPlan } from "../../types/explain";
import { isDataModifyingQuery } from "../../utils/explainPlan";
import {
  ExplainSummaryBar,
  type ExplainViewMode,
} from "./visual-explain/ExplainSummaryBar";
import { ExplainGraph } from "./visual-explain/ExplainGraph";
import { ExplainTableView } from "./visual-explain/ExplainTableView";
import { ExplainAiAnalysis } from "./visual-explain/ExplainAiAnalysis";

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
  const [plan, setPlan] = useState<ExplainPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ExplainViewMode>("graph");

  const isDml = query ? isDataModifyingQuery(query) : false;
  const [analyze, setAnalyze] = useState(!isDml);

  const handleExplain = useCallback(async () => {
    if (!query?.trim() || !connectionId) return;

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
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [query, connectionId, analyze, schema]);

  useEffect(() => {
    if (isOpen && query?.trim() && connectionId) {
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
              <p className="text-xs text-secondary">{plan?.driver ?? ""}</p>
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
                language="json"
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
              <ExplainTableView plan={plan} />
            ) : (
              <ExplainGraph plan={plan} />
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
