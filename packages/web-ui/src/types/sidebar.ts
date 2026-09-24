import type { SavedQuery } from "../contexts/SavedQueriesContext";
import type { RoutineInfo } from "../contexts/DatabaseContext";
import type { QueryHistoryEntry } from "./queryHistory";

export type ContextMenuData =
  | SavedQuery
  | { tableName: string; schema?: string }
  | (RoutineInfo & { schema?: string })
  | QueryHistoryEntry;
