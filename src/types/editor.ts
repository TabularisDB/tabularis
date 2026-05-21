import type { ForeignKey } from "./schema";

export type { ForeignKey };

export interface Pagination {
  page: number;
  page_size: number;
  total_rows: number | null;
  has_more: boolean;
}

export interface TableColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_nullable: boolean;
  is_auto_increment: boolean;
  default_value?: string;
  character_maximum_length?: number;
}

export interface TableSchema {
  name: string;
  columns: TableColumn[];
  foreign_keys: ForeignKey[];
}

export interface SchemaCache {
  data: TableSchema[];
  version: number;
  timestamp: number;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  affected_rows: number;
  truncated?: boolean;
  pagination?: Pagination;
}

/// One statement's outcome inside an `execute_query_batch` invocation.
/// Mirrors `src-tauri/src/models.rs::BatchStatementResult`. Exactly one of
/// `result` / `error` is non-null; `execution_time_ms` is measured
/// server-side per statement so the history UI shows accurate timings even
/// though the whole batch shares one Tauri round-trip.
export interface BatchStatementResult {
  result: QueryResult | null;
  error: string | null;
  execution_time_ms: number | null;
}

export interface QueryResultEntry {
  id: string;
  queryIndex: number;
  query: string;
  label?: string;
  result: QueryResult | null;
  error: string;
  executionTime: number | null;
  isLoading: boolean;
  page: number;
  activeTable: string | null;
  pkColumn: string | null;
}

import type { NotebookState } from "./notebook";
import type { Node, Edge } from "@xyflow/react";

export interface FlowState {
  nodes: Node[];
  edges: Edge[];
}

export interface PendingInsertion {
  tempId: string;
  data: Record<string, unknown>;
  displayIndex: number;
}

export interface Tab {
  id: string;
  title: string;
  type: "console" | "table" | "query_builder" | "notebook";
  query: string;
  result: QueryResult | null;
  error: string;
  executionTime: number | null;
  page: number;
  activeTable: string | null;
  pkColumn: string | null;
  autoIncrementColumns?: string[]; // Names of auto-increment columns
  defaultValueColumns?: string[]; // Names of columns with default values
  nullableColumns?: string[]; // Names of nullable columns
  columnMetadata?: TableColumn[]; // Full column metadata (includes data_type for geometric types, etc.)
  foreignKeys?: ForeignKey[]; // FK definitions for the active table (used for click-to-navigate)
  isLoading?: boolean;
  connectionId: string;
  flowState?: FlowState;
  pendingChanges?: Record<
    string,
    { pkOriginalValue: unknown; changes: Record<string, unknown> }
  >;
  pendingDeletions?: Record<string, unknown>; // Map of stringified PK -> original PK value
  pendingInsertions?: Record<string, PendingInsertion>; // Map of tempId -> pending insertion
  selectedRows?: number[]; // Selected row indices
  isEditorOpen?: boolean; // Whether the SQL editor is visible
  filterClause?: string; // SQL WHERE clause (without "WHERE")
  sortClause?: string; // SQL ORDER BY clause (without "ORDER BY")
  limitClause?: number; // SQL LIMIT value
  queryParams?: Record<string, string>; // Saved values for query parameters
  schema?: string; // Schema name (PostgreSQL) for query reconstruction
  readOnly?: boolean; // Hides the Run button (e.g. for definition views)
  results?: QueryResultEntry[];
  activeResultId?: string;
  notebookId?: string; // Reference to notebook file in config dir
  notebookState?: NotebookState; // Deprecated: kept for migration of old tabs
}

export interface EditorPreferences {
  tabs: Tab[];
  active_tab_id: string | null;
}
