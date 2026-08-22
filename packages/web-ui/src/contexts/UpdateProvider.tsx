import { useCallback, useState, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UpdateContext, type UpdateCheckResult } from "./UpdateContext";
import { toErrorMessage } from "../utils/errors";
import { useTabularisClient } from "../hooks/useTabularisClient";

export const UpdateProvider = ({ children }: { children: ReactNode }) => {
  const client = useTabularisClient();
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isUpToDate, setIsUpToDate] = useState(false);
  const [installationSource, setInstallationSource] = useState<string | null>(null);

  // Listen for download progress events
  useEffect(() => {
    const unlistenProgress = listen<number>("update-progress", (event) => {
      setDownloadProgress(event.payload);
    });

    const unlistenInstalling = listen("update-installing", () => {
      setDownloadProgress(100);
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenInstalling.then((fn) => fn());
    };
  }, []);

  const checkForUpdates = useCallback(async (force = false) => {
    setIsChecking(true);
    setError(null);
    setIsUpToDate(false);
    try {
      const result = await invoke<UpdateCheckResult>("check_for_updates", {
        force,
      });
      if (result.hasUpdate) {
        // A manual check (force) always surfaces an available update. Only a
        // background check honours a previous "remind me later" dismissal,
        // otherwise the button would keep reporting "up to date" forever once
        // a version has been dismissed.
        let dismissed = false;
        if (!force) {
          const config = await client.call("get_config", undefined);
          dismissed = config.lastDismissedVersion === result.latestVersion;
        }

        if (dismissed) {
          setUpdateInfo(null);
          setIsUpToDate(true);
        } else {
          setUpdateInfo(result);
          setIsUpToDate(false);
        }
      } else {
        // No update available
        setUpdateInfo(null);
        setIsUpToDate(true);
      }
    } catch (err) {
      console.error("Failed to check for updates:", err);
      setError(toErrorMessage(err));
      setIsUpToDate(false);
    } finally {
      setIsChecking(false);
    }
  }, [client]);

  const downloadAndInstall = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    setError(null);
    try {
      await invoke("download_and_install_update");
      // The application restarts automatically after installation.
    } catch (err) {
      console.error("Failed to download/install update:", err);
      setError(toErrorMessage(err));
      setIsDownloading(false);
    }
  };

  const dismissUpdate = async () => {
    if (updateInfo) {
      await client.call("save_config", {
        config: { lastDismissedVersion: updateInfo.latestVersion },
      });
      setUpdateInfo(null);
    }
  };

  // Check on mount (startup)
  useEffect(() => {
    const performStartupCheck = async () => {
      try {
        // Detect installation source first; managed packages skip built-in updates
        const source = await client.call("get_installation_source", undefined);
        setInstallationSource(source ?? null);
        if (source) return;

        const config = await client.call("get_config", undefined);
        if (config.autoCheckUpdatesOnStartup !== false) {
          // Default: check on startup
          await checkForUpdates(false);
        }
      } catch (err) {
        console.error("Startup update check failed:", err);
      }
    };

    // Delay startup checks so they do not block application initialization.
    const timer = setTimeout(performStartupCheck, 2000);
    return () => clearTimeout(timer);
  }, [checkForUpdates, client]);

  return (
    <UpdateContext.Provider
      value={{
        updateInfo,
        isChecking,
        isDownloading,
        downloadProgress,
        checkForUpdates,
        downloadAndInstall,
        dismissUpdate,
        error,
        isUpToDate,
        installationSource,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
};
