/**
 * Types for importing connections from other installed SQL clients.
 * Mirror the Rust structs in `src-tauri/src/connection_import_commands.rs`
 * and `connection_import/analyzer.rs` / `convert.rs`.
 */

export interface ImportSourceInfo {
  id: string;
  displayName: string;
  available: boolean;
  connectionCount: number;
  readsPasswordsFromKeychain: boolean;
  needsFile: boolean;
}

export type ImportItemStatus =
  | { kind: "ready" }
  | { kind: "duplicate"; existingId: string; existingName: string }
  | { kind: "warnings"; warnings: string[] };

export interface ImportItem {
  index: number;
  name: string;
  driverId: string;
  driverInstalled: boolean;
  host: string;
  port: number;
  database: string;
  username: string;
  hasSsh: boolean;
  hasPassword: boolean;
  groupName?: string;
  status: ImportItemStatus;
}

export interface ImportPreview {
  sourceName: string;
  credentialsAborted: boolean;
  items: ImportItem[];
}

/** Per-item disposition sent back to `apply_connection_import`. */
export type ImportAction = "import" | "skip" | "replace";

export interface ImportResolution {
  index: number;
  action: ImportAction;
  replaceExistingId?: string;
  /**
   * Target group for a newly-imported connection. An id assigns to that
   * existing group; `""` means "no group"; omitted falls back to the source
   * app's folder. Ignored for `replace`.
   */
  groupId?: string;
  /** Name of a group to create (or reuse by name). Wins over `groupId`. */
  newGroupName?: string;
  /** Existing group id to nest `newGroupName` under. Omitted → top level. */
  newGroupParentId?: string;
}
