/**
 * Types and pure helpers for the team share: a copy of selected connections
 * and their credentials kept on a shared folder, encrypted with a master
 * password (see `src-tauri/src/team_share`).
 */

/** What the last sync did, as reported by the backend. */
export interface TeamShareSyncReport {
  pulled: number;
  pushed: number;
  conflicts: number;
  removed: number;
  revision: number;
}

/** Snapshot of the team share for this machine. */
export interface TeamShareStatus {
  /** A vault path is recorded in the config. */
  configured: boolean;
  path: string | null;
  /** The vault file is actually there — the share may be offline. */
  vaultExists: boolean;
  /** The master password was entered in this session. */
  unlocked: boolean;
  revision: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  sharedConnectionIds: string[];
  lastSync: TeamShareSyncReport | null;
}

/**
 * The four states the settings panel and the startup gate care about.
 * `unreachable` is a configured share whose vault file is not there right
 * now, which is a network problem rather than a wrong password.
 */
export type TeamSharePhase = "disabled" | "unreachable" | "locked" | "unlocked";

export function teamSharePhase(status: TeamShareStatus | null): TeamSharePhase {
  if (!status?.configured) return "disabled";
  if (status.unlocked) return "unlocked";
  return status.vaultExists ? "locked" : "unreachable";
}

/**
 * Whether to ask for the master password. Only a configured share that is
 * still locked justifies the prompt — an unreachable one would just make the
 * user type a password that cannot be checked.
 */
export function needsUnlockPrompt(status: TeamShareStatus | null): boolean {
  return teamSharePhase(status) === "locked";
}

/** Which connections the list screen shows. */
export type ShareFilter = "all" | "shared" | "local";

/**
 * Narrow a connection list to the shared ones or the local ones.
 *
 * Reads the connection's own `shared` flag rather than the status' id list, so
 * the list stays right even between a sync and the next status refresh.
 */
export function filterByShare<T extends { shared?: boolean }>(
  items: readonly T[],
  filter: ShareFilter,
): T[] {
  if (filter === "all") return [...items];
  const wantShared = filter === "shared";
  return items.filter((item) => (item.shared ?? false) === wantShared);
}

/** How many of `items` are shared — for the bulk action labels. */
export function countShared<T extends { shared?: boolean }>(
  items: readonly T[],
): number {
  return items.filter((item) => item.shared ?? false).length;
}

/** Total number of records a sync touched. Zero means "already in sync". */
export function syncChangeCount(report: TeamShareSyncReport | null): number {
  if (!report) return 0;
  return report.pulled + report.pushed + report.conflicts + report.removed;
}

/**
 * File name of the vault, for a compact label. Handles both separators
 * because the path comes from the OS the user picked it on.
 */
export function vaultFileName(path: string | null): string {
  if (!path) return "";
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

/** Folder holding the vault, for the "where is it" line in the panel. */
export function vaultFolder(path: string | null): string {
  if (!path) return "";
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : path;
}

/**
 * Reasons a master password is refused before it ever reaches the vault.
 * Returns an i18n key, or `null` when the password is acceptable.
 */
export function masterPasswordError(
  password: string,
  confirmation: string | null,
): string | null {
  if (password.trim().length === 0) return "settings.teamShare.errorEmptyPassword";
  if (confirmation !== null && password !== confirmation) {
    return "settings.teamShare.errorPasswordMismatch";
  }
  return null;
}
