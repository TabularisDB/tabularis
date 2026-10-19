export interface DatabaseBackupPlan {
  enabled: boolean;
  connectionId: string;
  database?: string;
  schema?: string;
  /** Daily run time in 24h format "HH:mm", e.g. "02:00" */
  time: string;
  /** IANA timezone identifier, e.g. "UTC", "America/New_York", or "local" */
  timezone: string;
  destinationDirectory: string;
  /** Number of successful backups to retain (default: 7) */
  retention: number;
  includeStructure: boolean;
  includeData: boolean;
  tables?: string[];
}

export type DatabaseBackupOutcome = "success" | "error" | "cancelled";

export interface DatabaseBackupStatus {
  lastRunAt: string | null;
  lastOutcome: DatabaseBackupOutcome | null;
  lastError: string | null;
  lastBackupFile: string | null;
  nextRunAt: string | null;
  isRunning: boolean;
}

export interface DriverDumpCapability {
  capable: boolean;
  reason?: string;
}
