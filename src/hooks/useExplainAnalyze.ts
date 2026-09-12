import { useCallback, useState } from "react";
import { isDataModifyingQuery } from "../utils/sql";

interface UseExplainAnalyzeOptions {
  connectionId: string;
  query: string;
  schema?: string | null;
  /** Default for the Analyze toggle until the user picks one; ignored for DML. */
  defaultEnabled?: boolean;
}

/**
 * Owns the EXPLAIN ANALYZE opt-in. ANALYZE really executes the statement, so the
 * choice is bound to the source it was made for: editing the query, schema or
 * connection drops it, and a data-modifying statement is never analyzed unless
 * the user opts in for that exact source.
 */
export function useExplainAnalyze({
  connectionId,
  query,
  schema,
  defaultEnabled = false,
}: UseExplainAnalyzeOptions) {
  const [choice, setChoice] = useState<{ sourceKey: string; enabled: boolean } | null>(null);
  const sourceKey = JSON.stringify([connectionId, schema ?? null, query]);
  const isDml = isDataModifyingQuery(query);

  if (choice && choice.sourceKey !== sourceKey) setChoice(null);
  const analyze =
    choice?.sourceKey === sourceKey ? choice.enabled : defaultEnabled && !isDml;

  const setAnalyze = useCallback(
    (enabled: boolean) => setChoice({ sourceKey, enabled }),
    [sourceKey],
  );

  return { sourceKey, analyze, setAnalyze, isDml };
}
