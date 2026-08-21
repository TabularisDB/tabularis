import { createContext } from "react";


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
}

export const UpdateContext = createContext<UpdateContextType | undefined>(
  undefined,
);
