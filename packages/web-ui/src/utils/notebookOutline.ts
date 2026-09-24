import type { NotebookCell } from "../types/notebook";

export interface OutlineEntry {
  level: number;
  text: string;
  cellId: string;
  cellIndex: number;
  cellType: "sql" | "markdown";
}

const HEADING_REGEX = /^(#{1,3})\s+(.+)$/;

/** Return cells that have content but no name (candidates for AI naming). */
export function getUnnamedCellsWithContent(cells: NotebookCell[]): NotebookCell[] {
  return cells.filter((c) => !c.name && c.content.trim());
}

/** Extract outline entries from all cells for TOC rendering. */
export function extractOutline(cells: NotebookCell[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];

    if (cell.type === "sql") {
      entries.push({
        level: 1,
        text: cell.name || `SQL #${i + 1}`,
        cellId: cell.id,
        cellIndex: i,
        cellType: "sql",
      });
      continue;
    }

    // Markdown cell: use name if set, otherwise extract headings
    if (cell.type === "markdown") {
      if (cell.name) {
        entries.push({
          level: 1,
          text: cell.name,
          cellId: cell.id,
          cellIndex: i,
          cellType: "markdown",
        });
        continue;
      }

      if (!cell.content.trim()) {
        entries.push({
          level: 1,
          text: `MD #${i + 1}`,
          cellId: cell.id,
          cellIndex: i,
          cellType: "markdown",
        });
        continue;
      }

      const lines = cell.content.split("\n");
      let hasHeading = false;
      for (const line of lines) {
        const match = line.match(HEADING_REGEX);
        if (match) {
          hasHeading = true;
          entries.push({
            level: match[1].length,
            text: match[2].trim(),
            cellId: cell.id,
            cellIndex: i,
            cellType: "markdown",
          });
        }
      }

      // If markdown cell has content but no headings, show fallback
      if (!hasHeading) {
        entries.push({
          level: 1,
          text: `MD #${i + 1}`,
          cellId: cell.id,
          cellIndex: i,
          cellType: "markdown",
        });
      }
    }
  }

  return entries;
}
