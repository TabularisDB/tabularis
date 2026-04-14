import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../../hooks/useSettings";
import type { ExplainPlan } from "../../../types/explain";

interface ExplainAiAnalysisProps {
  plan: ExplainPlan;
}

export function ExplainAiAnalysis({ plan }: ExplainAiAnalysisProps) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [analysis, setAnalysis] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!settings.aiProvider) {
      setError(t("editor.visualExplain.aiConfigRequired"));
      return;
    }

    setIsLoading(true);
    setError(null);
    setAnalysis("");

    const queryWithPlan = [
      "SQL Query:",
      plan.original_query,
      "",
      "EXPLAIN output:",
      plan.raw_output ?? "(no raw output available)",
    ].join("\n");

    try {
      const result = await invoke<string>("analyze_ai_explain_plan", {
        req: {
          provider: settings.aiProvider,
          model: settings.aiModel || "",
          query: queryWithPlan,
          language: settings.language === "it" ? "Italian" : settings.language === "es" ? "Spanish" : settings.language === "zh" ? "Chinese" : "English",
        },
      });
      setAnalysis(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [plan, settings.aiProvider, settings.aiModel, settings.language, t]);

  useEffect(() => {
    if (plan.raw_output) {
      handleAnalyze();
    }
  }, [plan, handleAnalyze]);

  return (
    <div className="h-full overflow-y-auto p-6">
      {!settings.aiProvider && (
        <div className="bg-yellow-900/20 border border-yellow-500/30 text-yellow-300 px-4 py-3 rounded-lg text-sm mb-4">
          {t("editor.visualExplain.aiConfigRequired")}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">
            {t("editor.visualExplain.aiAnalyzing")}
          </span>
        </div>
      ) : error ? (
        <div className="text-error-text text-sm">{error}</div>
      ) : analysis ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-purple-400 text-sm font-medium">
            <Sparkles size={14} />
            {t("editor.visualExplain.aiAnalysisTitle")}
          </div>
          <div className="text-secondary leading-relaxed whitespace-pre-wrap text-sm">
            {analysis}
          </div>
        </div>
      ) : null}
    </div>
  );
}
