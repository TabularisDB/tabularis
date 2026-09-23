import { invoke } from "@tauri-apps/api/core";

/** Where the folder in use was resolved from (mirrors the Rust enum). */
export type StorageLocationSource = "default" | "custom" | "env";

export interface StorageLocationInfo {
  /** Folder the running app is actually using. */
  currentPath: string;
  /** Platform default folder. */
  defaultPath: string;
  /** Folder recorded by the user, if any. */
  customPath: string | null;
  source: StorageLocationSource;
  /** The recorded folder differs from the one in use: restart to apply. */
  restartRequired: boolean;
}

export interface StorageLocationInspection {
  exists: boolean;
  isEmpty: boolean;
  hasTabularisData: boolean;
}

/** How to initialise a newly chosen storage folder. */
export type NewFolderMode = "copy" | "empty" | "existing";

/**
 * Pick the sensible default for a freshly chosen folder: reuse data that is
 * already there (e.g. synced from another machine), otherwise offer to copy
 * the current data into it.
 */
export function defaultModeFor(inspection: StorageLocationInspection): NewFolderMode {
  return inspection.hasTabularisData ? "existing" : "copy";
}

/** Folder Tabularis will switch to after a restart, or null when none is pending. */
export function pendingPathOf(info: StorageLocationInfo): string | null {
  if (!info.restartRequired) return null;
  return info.customPath ?? info.defaultPath;
}

let appDataDirPromise: Promise<string> | null = null;

/**
 * Absolute data directory as resolved by the backend, honouring a custom
 * storage location. Cached for the page lifetime: the folder cannot change
 * without a restart. Prefer this over `appDataDir()` from the Tauri path API,
 * which only knows the platform default.
 */
export function getAppDataDir(): Promise<string> {
  if (!appDataDirPromise) {
    appDataDirPromise = invoke<string>("get_app_data_dir").catch((e: unknown) => {
      appDataDirPromise = null;
      throw e;
    });
  }
  return appDataDirPromise;
}

/** Test hook: forget the cached directory. */
export function resetAppDataDirCache(): void {
  appDataDirPromise = null;
}
