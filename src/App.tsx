import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { MainLayout } from "./components/layout/MainLayout";
import { ConnectionLayoutProvider } from "./contexts/ConnectionLayoutProvider";
import { KeybindingsProvider } from "./contexts/KeybindingsProvider";
import { AlertProvider } from "./contexts/AlertProvider";
import { Connections } from "./pages/Connections";
import { Editor } from "./pages/Editor";
import { Settings } from "./pages/Settings";
import { SchemaDiagramPage } from "./pages/SchemaDiagramPage";
import { TaskManagerPage } from "./pages/TaskManagerPage";
import { UpdateNotificationModal } from "./components/modals/UpdateNotificationModal";
import { CommunityModal } from "./components/modals/CommunityModal";
import { useUpdate } from "./hooks/useUpdate";

const COMMUNITY_MODAL_KEY = "tabularis_community_modal_dismissed";

export function App() {
  const {
    updateInfo,
    isDownloading,
    downloadProgress,
    downloadAndInstall,
    dismissUpdate,
    error: updateError,
  } = useUpdate();
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [isCommunityModalOpen, setIsCommunityModalOpen] = useState(
    () => !localStorage.getItem(COMMUNITY_MODAL_KEY),
  );

  const dismissCommunityModal = useCallback(() => {
    localStorage.setItem(COMMUNITY_MODAL_KEY, "1");
    setIsCommunityModalOpen(false);
  }, []);

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
        <KeybindingsProvider>
        <ConnectionLayoutProvider>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Navigate to="/connections" replace />} />
              <Route path="connections" element={<Connections />} />
              <Route path="editor" element={<Editor />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="/schema-diagram" element={<SchemaDiagramPage />} />
            <Route path="/task-manager" element={<TaskManagerPage />} />
          </Routes>
        </ConnectionLayoutProvider>
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
        isOpen={isCommunityModalOpen}
        onClose={dismissCommunityModal}
      />
    </>
  );
}

