import type { Index } from "../types/schema";

export type GroupedIndex = Index & { columns: string[] };

// The backend returns one row per indexed column; collapse to one entry per index.
export function groupIndexes(indexes: Index[]): GroupedIndex[] {
  const groups: Record<string, GroupedIndex> = {};
  indexes.forEach((idx) => {
    if (!groups[idx.name]) groups[idx.name] = { ...idx, columns: [] };
    groups[idx.name].columns.push(idx.column_name);
  });
  return Object.values(groups);
}
