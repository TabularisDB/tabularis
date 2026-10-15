export interface QueryHistoryEntry {
  id: string;
  sql: string;
  executedAt: string;
  executionTimeMs: number | null;
  status: "success" | "error";
  rowsAffected: number | null;
  error: string | null;
  database: string | null;
}

export interface QueryHistoryResponse {
  entries: QueryHistoryEntry[];
  recoveredBackupPath: string | null;
}

export interface QueryHistoryRecoveryNotice {
  connectionId: string;
  backupPath: string;
}
