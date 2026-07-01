import type { SavedQuery } from "../contexts/SavedQueriesContext";
import type { RoutineInfo } from "../contexts/DatabaseContext";
import type { QueryHistoryEntry } from "./queryHistory";

export type ContextMenuData =
  | SavedQuery
  | { tableName: string; schema?: string; database?: string }
  // Routines carry the schema they live in plus, on schema-based
  // multi-database connections (PostgreSQL), the database whose pool their
  // metadata/DDL lookups must be routed to.
  | (RoutineInfo & { schema?: string; database?: string })
  | QueryHistoryEntry;
