import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { MonacoEditor } from "../ui/LazyMonaco";
import type * as monaco from "monaco-editor";
import type { ExplainPlan } from "@tabularis/explain";
import {
  computeExplainMetrics,
  findExplainNode,
  getPlanDiagnostics,
} from "@tabularis/explain";
import {
  ExplainDiagramView,
  ExplainGraph,
  ExplainNodeDetails,
  ExplainOverviewBar,
  ExplainStatsView,
  ExplainSummaryBar,
  ExplainTableView,
  type ExplainViewMode,
} from "@tabularis/explain/react";
import { useEditorTheme } from "../../hooks/useEditorTheme";
import { useAlert } from "../../hooks/useAlert";
import { loadMonacoTheme } from "../../themes/themeUtils";
import { getMonacoThemeId } from "../../themes/themeRuntime";
import {
  detectRawExplainLanguage,
  formatRawExplainOutput,
  saveRawExplainOutput,
} from "../../utils/explainRaw";
import { ExplainAiAnalysis } from "../modals/visual-explain/ExplainAiAnalysis";

export interface VisualExplainViewProps {
  plan: ExplainPlan | null;
  isLoading: boolean;
  error: string | null;
  viewMode: ExplainViewMode;
  onViewModeChange: (mode: ExplainViewMode) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  aiEnabled: boolean;
}

/**
 * Pure presentation of a resolved `ExplainPlan`. Does not fetch data itself —
 * both the Editor modal and the standalone CLI page feed it `plan`.
 */
export const VisualExplainView = ({
  plan,
  isLoading,
  error,
  viewMode,
  onViewModeChange,
  selectedNodeId,
  onSelectNode,
  aiEnabled,
}: VisualExplainViewProps) => {
  const { t } = useTranslation();
  const editorTheme = useEditorTheme();

  // Computed once per plan and shared by every view, so switching views does not
  // walk the tree again.
  const metrics = useMemo(
    () => (plan ? computeExplainMetrics(plan) : null),
    [plan],
  );

  const diagnostics = useMemo(
    () => (plan && metrics ? getPlanDiagnostics(plan, metrics) : null),
    [plan, metrics],
  );

  const selectedNode = useMemo(
    () => (plan ? findExplainNode(plan.root, selectedNodeId) : null),
    [plan, selectedNodeId],
  );

  const { showAlert } = useAlert();
  const [isSaving, setIsSaving] = useState(false);

  const rawLanguage = useMemo(
    () => (plan?.raw_output ? detectRawExplainLanguage(plan.raw_output) : "plaintext"),
    [plan],
  );

  const rawFormatLabel = useMemo(() => {
    switch (rawLanguage) {
      case "json":
        return "JSON";
      case "xml":
        return "XML";
      case "plaintext":
      default:
        return t("editor.visualExplain.formatText", "Text");
    }
  }, [rawLanguage, t]);

  const rawValue = useMemo(
    () => (plan?.raw_output ? formatRawExplainOutput(plan.raw_output) : ""),
    [plan],
  );

  const handleBeforeMount = useCallback(
    (monacoInstance: typeof monaco) => {
      loadMonacoTheme(editorTheme, monacoInstance);
    },
    [editorTheme],
  );

  const handleSaveRaw = useCallback(async () => {
    // Capture the selected plan synchronously before awaiting the dialog
    const planSnapshot = plan;
    const rawToSave = planSnapshot?.raw_output;
    if (!rawToSave || isSaving) return;

    setIsSaving(true);
    try {
      const saved = await saveRawExplainOutput(rawToSave);
      if (saved) {
        showAlert(t("editor.visualExplain.rawExported"), { kind: "info" });
      }
    } catch (e) {
      console.error("Failed to save raw EXPLAIN output", e);
      showAlert(t("editor.visualExplain.saveRawError"), { kind: "error" });
    } finally {
      setIsSaving(false);
    }
  }, [plan, isSaving, showAlert, t]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <ExplainSummaryBar
        plan={plan}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        aiEnabled={aiEnabled}
      />
      {plan && metrics && (
        <ExplainOverviewBar
          plan={plan}
          metrics={metrics}
          onSelectNode={onSelectNode}
        />
      )}

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
        ) : plan && metrics && diagnostics ? (
          viewMode === "raw" ? (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between px-4 py-2 border-b border-default bg-base/40">
                <span className="text-xs font-mono uppercase text-muted">
                  {rawFormatLabel}
                </span>
                <button
                  type="button"
                  onClick={handleSaveRaw}
                  disabled={!plan.raw_output || isSaving}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-default bg-surface hover:bg-surface-secondary text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  title={t("editor.visualExplain.saveRawPlan")}
                  aria-label={t("editor.visualExplain.saveRawPlan")}
                >
                  <Download size={14} className="text-secondary" />
                  <span>{t("editor.visualExplain.saveRawPlan")}</span>
                </button>
              </div>
              <div className="flex-1 min-h-0">
                {plan.raw_output ? (
                  <MonacoEditor
                    height="100%"
                    language={rawLanguage}
                    theme={getMonacoThemeId(editorTheme.id)}
                    value={rawValue}
                    beforeMount={handleBeforeMount}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 12,
                      wordWrap: "on",
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-muted">
                    {t("editor.visualExplain.noRawOutput")}
                  </div>
                )}
              </div>
            </div>
          ) : viewMode === "ai" ? (
            <ExplainAiAnalysis plan={plan} />
          ) : viewMode === "table" ? (
            <ExplainTableView
              plan={plan}
              metrics={metrics}
              diagnostics={diagnostics}
              selectedId={selectedNodeId}
              onSelect={onSelectNode}
            />
          ) : viewMode === "diagram" ? (
            <ExplainDiagramView
              plan={plan}
              metrics={metrics}
              diagnostics={diagnostics}
              selectedId={selectedNodeId}
              onSelect={onSelectNode}
            />
          ) : viewMode === "stats" ? (
            <ExplainStatsView plan={plan} metrics={metrics} />
          ) : (
            <div className="flex h-full">
              <div className="flex-1 min-w-0 border-r border-default">
                <ExplainGraph
                  plan={plan}
                  metrics={metrics}
                  diagnostics={diagnostics}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                />
              </div>
              <div className="w-[320px] shrink-0 overflow-y-auto bg-base/50">
                <ExplainNodeDetails
                  node={selectedNode}
                  hasAnalyzeData={plan.has_analyze_data}
                  metrics={
                    selectedNode ? metrics.byId.get(selectedNode.id) ?? null : null
                  }
                  diagnostics={
                    selectedNode ? diagnostics.get(selectedNode.id) ?? [] : []
                  }
                />
              </div>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
};
