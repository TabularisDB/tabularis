import type { NotebookCell, RunAllResult } from "../types/notebook";

export function getExecutableCells(
  cells: NotebookCell[],
): Array<{ cell: NotebookCell; index: number }> {
  return cells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.type === "sql" && cell.content.trim() !== "");
}

export function createRunAllResult(): RunAllResult {
  return {
    total: 0,
    executed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
}

export function addSuccess(result: RunAllResult): RunAllResult {
  return {
    ...result,
    executed: result.executed + 1,
    succeeded: result.succeeded + 1,
  };
}

export function addFailure(
  result: RunAllResult,
  cellId: string,
  cellIndex: number,
  error: string,
): RunAllResult {
  return {
    ...result,
    executed: result.executed + 1,
    failed: result.failed + 1,
    errors: [...result.errors, { cellId, cellIndex, error }],
  };
}

export function addSkipped(result: RunAllResult, count: number): RunAllResult {
  return {
    ...result,
    skipped: result.skipped + count,
  };
}

export function formatRunAllSummary(result: RunAllResult): string {
  const parts: string[] = [];
  if (result.succeeded > 0) parts.push(`${result.succeeded} succeeded`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  return parts.join(", ");
}
