// Types mirror the Rust structs in src-tauri/src/ai_activity.rs and
// src-tauri/src/ai_approval.rs (camelCase via #[serde(rename_all)]).

export type AiQueryKind = "select" | "write" | "ddl" | "unknown";

export type AiActivityStatus =
  | "success"
  | "blocked_readonly"
  | "blocked_pending_approval"
  | "denied"
  | "error"
  | "timeout";

export type AiToolName =
  | "list_connections"
  | "list_databases"
  | "list_tables"
  | "describe_table"
  | "run_query"
  | (string & {});

export interface AiActivityEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  tool: AiToolName;
  connectionId: string | null;
  connectionName: string | null;
  query: string | null;
  queryKind: AiQueryKind | null;
  durationMs: number;
  status: AiActivityStatus;
  rows: number | null;
  error: string | null;
  clientHint: string | null;
  approvalId: string | null;
}

export interface AiSessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  runQueryCount: number;
  connectionNames: string[];
  clientHint: string | null;
}

export interface AiEventFilter {
  sessionId?: string;
  connectionId?: string;
  tool?: string;
  status?: AiActivityStatus;
  queryContains?: string;
  since?: string;
  until?: string;
}

export interface PendingApproval {
  id: string;
  createdAt: string;
  sessionId: string;
  connectionId: string;
  connectionName: string;
  query: string;
  queryKind: AiQueryKind;
  clientHint: string | null;
  explainPlan: unknown | null;
  explainError: string | null;
}

export type ApprovalDecisionKind = "approve" | "deny";

export interface ApprovalDecisionPayload {
  approvalId: string;
  decision: ApprovalDecisionKind;
  reason?: string;
  editedQuery?: string;
}

export type McpApprovalMode = "off" | "writes_only" | "all";

// Notebook export shape returned by `export_ai_session_as_notebook`. The
// frontend treats it as a NotebookFile (see src/types/notebook.ts).
export interface AiNotebookExportCell {
  type: "sql" | "markdown";
  content: string;
  name?: string;
  schema?: string;
}

export interface AiNotebookExport {
  version: number;
  title: string;
  createdAt: string;
  cells: AiNotebookExportCell[];
}
