import type { NotebookCell, NotebookCellType, NotebookState } from "../types/notebook";

export function generateCellId(): string {
  return `cell_${Math.random().toString(36).substring(2, 9)}`;
}

export function createEmptyCell(type: NotebookCellType): NotebookCell {
  return {
    id: generateCellId(),
    type,
    content: "",
    result: null,
    error: undefined,
    executionTime: null,
    isLoading: false,
    isPreview: type === "markdown" ? false : undefined,
  };
}

export function createDefaultNotebookState(): NotebookState {
  return {
    cells: [createEmptyCell("sql")],
  };
}

export function updateCellInCells(
  cells: NotebookCell[],
  cellId: string,
  partial: Partial<NotebookCell>,
): NotebookCell[] {
  return cells.map((c) => (c.id === cellId ? { ...c, ...partial } : c));
}

export function addCellToCells(
  cells: NotebookCell[],
  type: NotebookCellType,
  afterIndex?: number,
): NotebookCell[] {
  const newCell = createEmptyCell(type);
  const result = [...cells];
  const insertAt = afterIndex !== undefined ? afterIndex + 1 : result.length;
  result.splice(insertAt, 0, newCell);
  return result;
}

export function removeCellFromCells(
  cells: NotebookCell[],
  cellId: string,
): NotebookCell[] {
  return cells.filter((c) => c.id !== cellId);
}

export function moveCellInCells(
  cells: NotebookCell[],
  cellId: string,
  direction: -1 | 1,
): NotebookCell[] {
  const idx = cells.findIndex((c) => c.id === cellId);
  if (idx === -1) return cells;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= cells.length) return cells;
  const result = [...cells];
  [result[idx], result[newIdx]] = [result[newIdx], result[idx]];
  return result;
}

export function extractSqlFromCells(cells: NotebookCell[]): string {
  return cells
    .filter((c) => c.type === "sql" && c.content.trim())
    .map((c) => c.content.trim())
    .join("\n\n");
}
