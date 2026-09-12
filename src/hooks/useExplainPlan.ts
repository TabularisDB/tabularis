import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { ExplainPlan, ExplainQueryOutput } from "@tabularis/explain";
import { resolveExplainOutput } from "@tabularis/explain";
import type { ExplainViewMode } from "@tabularis/explain/react";
import { isExplainableQuery } from "../utils/sql";
import { toErrorMessage } from "../utils/errors";
import { useLatestAsync } from "./useLatestAsync";

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
  const { run, invalidate: invalidateRequest } = useLatestAsync();

  const invalidate = useCallback(() => {
    invalidateRequest("explain-plan");
  }, [invalidateRequest]);

  const reset = useCallback((loading = false) => {
    setIsLoading(loading);
    setError(null);
    setPlan(null);
    setSelectedNodeId(null);
  }, []);

  const loadPlan = useCallback(
    async (operation: () => Promise<ExplainPlan>): Promise<void> => {
      const result = await run("explain-plan", async () => {
        reset(true);
        const parsed = await operation();
        return { plan: parsed, selectedNodeId: parsed.root.id };
      });
      if (result.status === "stale") return;
      if (result.status === "success") {
        setPlan(result.value.plan);
        setSelectedNodeId(result.value.selectedNodeId);
      } else {
        setError(toErrorMessage(result.error));
      }
      setIsLoading(false);
    },
    [reset, run],
  );

  const runExplain = useCallback(
    async ({ connectionId, query, analyze = false, schema = null }: RunExplainArgs) => {
      if (!query?.trim() || !connectionId?.trim()) {
        invalidate();
        reset();
        return;
      }
      await loadPlan(async () => {
        if (!isExplainableQuery(query)) {
          throw t("editor.visualExplain.notExplainable");
        }
        const result = await invoke<ExplainQueryOutput>("explain_query_plan", {
          connectionId,
          query,
          analyze,
          schema: schema || null,
        });
        return resolveExplainOutput(result);
      });
    },
    [invalidate, loadPlan, reset, t],
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
    loadPlan,
    invalidate,
  };
}
