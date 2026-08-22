import { createContext } from "react";
import type { ServerBuildInformation } from "../api/session";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseUrl: string;
  publishedAt: string;
  downloadUrls: DownloadAsset[];
}

interface DownloadAsset {
  name: string;
  url: string;
  size: number;
  platform: string;
}

export type UpdaterMode = "native" | "server-managed";

export interface ServerRuntimeInformation {
  readonly version: string;
  readonly build: ServerBuildInformation;
}

interface UpdateContextType {
  updateInfo: UpdateCheckResult | null;
  isChecking: boolean;
  isDownloading: boolean;
  downloadProgress: number;
  checkForUpdates: (force?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissUpdate: () => void;
  error: string | null;
  isUpToDate: boolean;
  installationSource: string | null;
  updaterMode: UpdaterMode;
  serverInfo: ServerRuntimeInformation | null;
}

export const UpdateContext = createContext<UpdateContextType | undefined>(
  undefined,
);
