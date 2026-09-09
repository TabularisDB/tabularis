import { useCallback, useState } from "react";
import { isDataModifyingQuery } from "../utils/sql";

interface ExplainSource {
  connectionId: string;
  query: string;
  schema?: string | null;
}

interface UseExplainAnalyzeOptions extends ExplainSource {
  /** Value for a source the user has not decided on. Ignored while it writes data. */
  defaultEnabled?: boolean;
}

/**
 * Identity of an explain source. Two sources with the same key produce the same
 * plan, so state bound to one stays valid only while the key is unchanged.
 */
export function explainSourceKey({ connectionId, query, schema }: ExplainSource): string {
  return JSON.stringify([connectionId, schema ?? null, query]);
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
  const sourceKey = explainSourceKey({ connectionId, query, schema });
  const isDml = isDataModifyingQuery(query);
  // Forget the choice as soon as the source moves on, so returning to an earlier
  // query cannot silently restore an opt-in the user made before editing it.
  if (choice && choice.sourceKey !== sourceKey) setChoice(null);
  const analyze =
    choice?.sourceKey === sourceKey ? choice.enabled : defaultEnabled && !isDml;

  const setAnalyze = useCallback(
    (enabled: boolean) => setChoice({ sourceKey, enabled }),
    [sourceKey],
  );

  return { sourceKey, analyze, setAnalyze, isDml };
}
