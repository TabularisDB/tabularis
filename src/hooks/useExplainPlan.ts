import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { ExplainPlan, ExplainQueryOutput } from "@tabularis/explain";
import { resolveExplainOutput } from "@tabularis/explain";
import type { ExplainViewMode } from "@tabularis/explain/react";
import { isExplainableQuery } from "../utils/sql";

interface RunExplainArgs {
  connectionId: string;
  query: string;
  analyze?: boolean;
  schema?: string | null;
}

/**
 * Owns the state and Tauri call for running EXPLAIN / EXPLAIN ANALYZE. Shared by
 * every explain surface (the inline SQL-cell section, the modal, and the page)
 * so the invoke + parse + selection logic lives in one place. Callers own their
 * own trigger (button, effect) and any `analyze` toggle.
 */
export function useExplainPlan(initialPlan: ExplainPlan | null = null) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<ExplainPlan | null>(initialPlan);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ExplainViewMode>("graph");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialPlan?.root.id ?? null,
  );

  const runExplain = useCallback(
    async ({ connectionId, query, analyze = false, schema = null }: RunExplainArgs) => {
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
          analyze,
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
    [t],
  );

  return {
    plan,
    setPlan,
    isLoading,
    setIsLoading,
    error,
    setError,
    viewMode,
    setViewMode,
    selectedNodeId,
    setSelectedNodeId,
    runExplain,
  };
}
