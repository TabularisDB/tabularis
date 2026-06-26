import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import MonacoEditor from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import type { ExplainPlan } from "../../types/explain";
import { findExplainNode } from "../../utils/explainPlan";
import { useEditorTheme } from "../../hooks/useEditorTheme";
import { loadMonacoTheme } from "../../themes/themeUtils";
import {
  ExplainSummaryBar,
  type ExplainViewMode,
} from "../modals/visual-explain/ExplainSummaryBar";
import { ExplainGraph } from "../modals/visual-explain/ExplainGraph";
import { ExplainTableView } from "../modals/visual-explain/ExplainTableView";
import { ExplainAiAnalysis } from "../modals/visual-explain/ExplainAiAnalysis";
import { ExplainNodeDetails } from "../modals/visual-explain/ExplainNodeDetails";
import { ExplainOverviewBar } from "../modals/visual-explain/ExplainOverviewBar";

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

  const selectedNode = useMemo(
    () => (plan ? findExplainNode(plan.root, selectedNodeId) : null),
    [plan, selectedNodeId],
  );

  const rawLanguage = useMemo(() => {
    if (!plan?.raw_output) return "plaintext";
    const trimmed = plan.raw_output.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[")
      ? "json"
      : "plaintext";
  }, [plan]);

  const handleBeforeMount = useCallback(
    (monacoInstance: typeof monaco) => {
      loadMonacoTheme(editorTheme, monacoInstance);
    },
    [editorTheme],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <ExplainSummaryBar
        plan={plan}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        aiEnabled={aiEnabled}
      />
      {plan && (
        <ExplainOverviewBar plan={plan} onSelectNode={onSelectNode} />
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
        ) : plan ? (
          viewMode === "raw" && plan.raw_output ? (
            <MonacoEditor
              height="100%"
              language={rawLanguage}
              theme={editorTheme.id}
              value={plan.raw_output}
              beforeMount={handleBeforeMount}
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
              onSelect={onSelectNode}
            />
          ) : (
            <div className="flex h-full">
              <div className="flex-1 min-w-0 border-r border-default">
                <ExplainGraph
                  plan={plan}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
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
    </div>
  );
};
