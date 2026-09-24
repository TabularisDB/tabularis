import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAlert } from "../hooks/useAlert";

/**
 * Headless component that listens for backend connection-health-failed events
 * and shows an alert toast. Must be rendered inside AlertProvider and BrowserRouter.
 */
export function ConnectionHealthMonitor() {
  const { showAlert } = useAlert();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const goToConnections = useCallback(() => {
    navigate("/connections");
  }, [navigate]);

  useEffect(() => {
    const unlisten = listen<{ connectionId: string; error: string }>(
      "connection-health-failed",
      (event) => {
        const { error } = event.payload;
        showAlert(
          `${t("healthCheck.connectionLost")}: ${error}`,
          {
            kind: "error",
            title: t("healthCheck.title"),
            onClose: goToConnections,
          },
        );
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [showAlert, t, goToConnections]);

  return null;
}
