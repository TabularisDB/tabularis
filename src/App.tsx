import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { MainLayout } from "./components/layout/MainLayout";
import { ConnectionLayoutProvider } from "./contexts/ConnectionLayoutProvider";
import { KeybindingsProvider } from "./contexts/KeybindingsProvider";
import { PluginSlotProvider } from "./contexts/PluginSlotProvider";
import { PluginModalProvider } from "./contexts/PluginModalProvider";
import { AlertProvider } from "./contexts/AlertProvider";
import { Connections } from "./pages/Connections";
import { Editor } from "./pages/Editor";
import { McpPage } from "./pages/McpPage";
import { Settings } from "./pages/Settings";
import { SchemaDiagramPage } from "./pages/SchemaDiagramPage";
import { TaskManagerPage } from "./pages/TaskManagerPage";
import { VisualExplainPage } from "./pages/VisualExplainPage";
import { JsonViewerPage } from "./pages/JsonViewerPage";
import { ConnectionHealthMonitor } from "./components/ConnectionHealthMonitor";
import { EditorErrorBoundary } from "./components/ui/EditorErrorBoundary";
import { UpdateNotificationModal } from "./components/modals/UpdateNotificationModal";
import { CommunityModal } from "./components/modals/CommunityModal";
import { WhatsNewModal } from "./components/modals/WhatsNewModal";
import { AiApprovalGate } from "./components/modals/AiApprovalGate";
import { useUpdate } from "./hooks/useUpdate";
import { useChangelog } from "./hooks/useChangelog";
import { useSettings } from "./hooks/useSettings";
import { APP_VERSION } from "./version";
import { isVersionAtMost, isVersionNewer } from "./utils/versionCompare";

const WHATS_NEW_VERSION_KEY = "tabularis_last_seen_version";

export function App() {
  const {
    updateInfo,
    isDownloading,
    downloadProgress,
    downloadAndInstall,
    dismissUpdate,
    error: updateError,
  } = useUpdate();
  const { settings, updateSetting, isLoading: isSettingsLoading } = useSettings();
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [isCommunityModalDismissed, setIsCommunityModalDismissed] = useState(false);

  const lastSeenVersion = localStorage.getItem(WHATS_NEW_VERSION_KEY);
  const [isWhatsNewOpen, setIsWhatsNewOpen] = useState(
    () => lastSeenVersion !== null && isVersionNewer(APP_VERSION, lastSeenVersion),
  );

  const { entries: allEntries, isLoading: isChangelogLoading } = useChangelog();

  const whatsNewEntries = useMemo(() => {
    if (!lastSeenVersion) return [];
    return allEntries.filter(
      (entry) =>
        isVersionNewer(entry.version, lastSeenVersion) &&
        isVersionAtMost(entry.version, APP_VERSION),
    );
  }, [lastSeenVersion, allEntries]);

  const dismissCommunityModal = useCallback(() => {
    updateSetting("showWelcome", false);
    localStorage.setItem(WHATS_NEW_VERSION_KEY, APP_VERSION);
    setIsCommunityModalDismissed(true);
  }, [updateSetting]);

  const dismissWhatsNew = useCallback(() => {
    localStorage.setItem(WHATS_NEW_VERSION_KEY, APP_VERSION);
    setIsWhatsNewOpen(false);
  }, []);

  // Seed WHATS_NEW_VERSION_KEY for users who completed the welcome flow
  // before the WhatsNew feature was introduced. Without this, lastSeenVersion
  // stays null and WhatsNew never triggers.
  useEffect(() => {
    if (
      !isSettingsLoading &&
      settings.showWelcome === false &&
      !localStorage.getItem(WHATS_NEW_VERSION_KEY)
    ) {
      localStorage.setItem(WHATS_NEW_VERSION_KEY, APP_VERSION);
    }
  }, [isSettingsLoading, settings.showWelcome]);

  useEffect(() => {
    invoke<boolean>("is_debug_mode").then((debugMode) => {
      setIsDebugMode(debugMode);
    });
  }, []);

  useEffect(() => {
    if (isDebugMode) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [isDebugMode]);

  return (
    <>
      <AlertProvider>
        <BrowserRouter>
          <ConnectionHealthMonitor />
          <KeybindingsProvider>
            <PluginSlotProvider>
              <PluginModalProvider>
                <ConnectionLayoutProvider>
                  <Routes>
                    <Route path="/" element={<MainLayout />}>
                      <Route
                        index
                        element={<Navigate to="/connections" replace />}
                      />
                      <Route path="connections" element={<Connections />} />
                      <Route
                        path="editor"
                        element={
                          <EditorErrorBoundary>
                            <Editor />
                          </EditorErrorBoundary>
                        }
                      />
                      <Route path="mcp" element={<McpPage />} />
                      <Route path="settings" element={<Settings />} />
                    </Route>
                    <Route
                      path="/schema-diagram"
                      element={<SchemaDiagramPage />}
                    />
                    <Route path="/task-manager" element={<TaskManagerPage />} />
                    <Route path="/visual-explain" element={<VisualExplainPage />} />
                    <Route path="/json-viewer" element={<JsonViewerPage />} />
                  </Routes>
                </ConnectionLayoutProvider>
              </PluginModalProvider>
            </PluginSlotProvider>
          </KeybindingsProvider>
        </BrowserRouter>
      </AlertProvider>

      <UpdateNotificationModal
        isOpen={!!updateInfo}
        onClose={dismissUpdate}
        updateInfo={updateInfo!}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        onDownloadAndInstall={downloadAndInstall}
        error={updateError}
      />

      <CommunityModal
        isOpen={!isSettingsLoading && settings.showWelcome !== false && !isCommunityModalDismissed}
        onClose={dismissCommunityModal}
      />

      <WhatsNewModal
        isOpen={isWhatsNewOpen && !isSettingsLoading && (settings.showWelcome === false || isCommunityModalDismissed)}
        onClose={dismissWhatsNew}
        entries={whatsNewEntries}
        isLoading={isChangelogLoading}
      />

      <AiApprovalGate />
    </>
  );
}
