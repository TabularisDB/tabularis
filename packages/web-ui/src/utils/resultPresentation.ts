import type { QueryResult, Tab } from "../types/editor";

type ResultPresentationTab = Pick<
  Tab,
  "type" | "result" | "pendingInsertions"
>;

/**
 * Distinguishes command results from an empty table browse result.
 * Table tabs must keep rendering their data controls so users can add the
 * first row even when a driver returns no column metadata for an empty table.
 */
export function shouldShowStatementSuccess(
  tab: ResultPresentationTab,
): tab is ResultPresentationTab & { result: QueryResult } {
  return (
    tab.type !== "table" &&
    tab.result !== null &&
    tab.result.columns.length === 0 &&
    Object.keys(tab.pendingInsertions ?? {}).length === 0
  );
}
