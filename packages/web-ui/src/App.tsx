import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "./components/layout/MainLayout";
import { ConnectionLayoutProvider } from "./contexts/ConnectionLayoutProvider";
import { RightSidebarProvider } from "./contexts/RightSidebarProvider";
import { KeybindingsProvider } from "./contexts/KeybindingsProvider";
import { PluginSlotProvider } from "./contexts/PluginSlotProvider";
import { PluginModalProvider } from "./contexts/PluginModalProvider";
import { AlertProvider } from "./contexts/AlertProvider";
import { Connections } from "./pages/Connections";
import { ConnectionEditorRoute } from "./pages/ConnectionEditorRoute";
import { McpPage } from "./pages/McpPage";
import { Settings } from "./pages/Settings";
import { SchemaDiagramPage } from "./pages/SchemaDiagramPage";
import { TaskManagerPage } from "./pages/TaskManagerPage";
import { VisualExplainPage } from "./pages/VisualExplainPage";
import { JsonViewerPage } from "./pages/JsonViewerPage";
import { ResultsWindowPage } from "./pages/ResultsWindowPage";
import { PluginInstallRoutePage } from "./pages/PluginInstallRoutePage";
import { ConnectionHealthMonitor } from "./components/ConnectionHealthMonitor";
import { UpdateNotificationModal } from "./components/modals/UpdateNotificationModal";
import { CommunityModal } from "./components/modals/CommunityModal";
import { WhatsNewModal } from "./components/modals/WhatsNewModal";
import { AiApprovalGate } from "./components/modals/AiApprovalGate";
import { PluginInstallConfirmModal } from "./components/modals/PluginInstallConfirmModal";
import { SshAskpassGate } from "./components/modals/SshAskpassGate";
import { BrowserPlatformDialogs } from "./components/modals/BrowserPlatformDialogs";
import { useUpdate } from "./hooks/useUpdate";
import { useChangelog } from "./hooks/useChangelog";
import { useSettings } from "./hooks/useSettings";
import { useDeepLinkInstall } from "./hooks/useDeepLinkInstall";
import { useResultTypeColors } from "./hooks/useResultTypeColors";
import { APP_VERSION } from "./version";
import { isVersionAtMost, isVersionNewer } from "./utils/versionCompare";
import { useTabularisClient } from "./hooks/useTabularisClient";
import { BROWSER_ROUTES, WEB_UI_BASE_PATH } from "./routing";

const WHATS_NEW_VERSION_KEY = "tabularis_last_seen_version";

export function App() {
  const client = useTabularisClient();
  const {
    updateInfo,
    isDownloading,
    downloadProgress,
    downloadAndInstall,
    dismissUpdate,
    error: updateError,
  } = useUpdate();
  const { settings, updateSetting, isLoading: isSettingsLoading } = useSettings();
  useResultTypeColors();
  const [isDebugMode, setIsDebugMode] = useState(false);
  const deepLinkInstall = useDeepLinkInstall();
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
    client.call("is_debug_mode", undefined).then((debugMode) => {
      setIsDebugMode(debugMode);
    });
  }, [client]);

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
        <BrowserPlatformDialogs />
        <BrowserRouter basename={WEB_UI_BASE_PATH}>
          <ConnectionHealthMonitor />
          <KeybindingsProvider>
            <PluginSlotProvider>
              <PluginModalProvider>
                <ConnectionLayoutProvider>
                  <RightSidebarProvider>
                  <Routes>
                    <Route path={BROWSER_ROUTES.root} element={<MainLayout />}>
                      <Route
                        index
                        element={<Navigate to={BROWSER_ROUTES.connections} replace />}
                      />
                      <Route path={BROWSER_ROUTES.connections} element={<Connections />} />
                      <Route
                        path={BROWSER_ROUTES.editor}
                        element={<ConnectionEditorRoute />}
                      />
                      <Route
                        path={BROWSER_ROUTES.connectionEditor}
                        element={<ConnectionEditorRoute />}
                      />
                      <Route path={BROWSER_ROUTES.mcp} element={<McpPage />} />
                      <Route path={BROWSER_ROUTES.settings} element={<Settings />} />
                    </Route>
                    <Route
                      path={BROWSER_ROUTES.schemaDiagram}
                      element={<SchemaDiagramPage />}
                    />
                    <Route path={BROWSER_ROUTES.taskManager} element={<TaskManagerPage />} />
                    <Route path={BROWSER_ROUTES.visualExplain} element={<VisualExplainPage />} />
                    <Route path={BROWSER_ROUTES.jsonViewer} element={<JsonViewerPage />} />
                    <Route
                      path={BROWSER_ROUTES.resultsWindow}
                      element={<ResultsWindowPage />}
                    />
                    <Route
                      path={BROWSER_ROUTES.pluginInstall}
                      element={<PluginInstallRoutePage />}
                    />
                  </Routes>
                  </RightSidebarProvider>
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
      <SshAskpassGate />

      <PluginInstallConfirmModal
        key={
          deepLinkInstall.pending
            ? `${deepLinkInstall.pending.slug}@${deepLinkInstall.pending.version ?? ""}@${deepLinkInstall.pending.registry ?? ""}`
            : "idle"
        }
        request={deepLinkInstall.pending}
        busy={deepLinkInstall.busy}
        error={deepLinkInstall.error}
        onConfirm={() => {
          void deepLinkInstall.confirm();
        }}
        onCancel={deepLinkInstall.cancel}
        configuredRegistry={settings.tabulariumRegistryUrl ?? null}
      />

    </>
  );
}
