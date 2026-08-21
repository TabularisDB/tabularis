import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDatabase } from "./useDatabase";

/** Label prefix used for dedicated single-connection windows. */
const CONNECTION_WINDOW_PREFIX = "connection-window-";

/**
 * Lifecycle for a dedicated connection window: once its bound connection has
 * been open and then becomes closed anywhere (disconnected here or from another
 * window), close this window. The main window is never a dedicated window, so it
 * is never auto-closed by this hook.
 */
export function useConnectionWindowLifecycle() {
  const { globallyOpenConnectionIds } = useDatabase();

  // The connection id this window was launched to show. Captured on first
  // render (before the app navigates away and strips the `?connect=` param).
  const boundIdRef = useRef<string | null | undefined>(undefined);
  if (boundIdRef.current === undefined) {
    boundIdRef.current = new URLSearchParams(window.location.search).get("connect");
  }

  // Guard so we don't close before the connection has finished opening on first
  // launch (the bound id isn't in the open set until connect() completes).
  const hasBeenOpenRef = useRef(false);

  useEffect(() => {
    const boundId = boundIdRef.current;
    const label = getCurrentWindow().label;
    const isDedicated = label.startsWith(CONNECTION_WINDOW_PREFIX);
    if (!isDedicated || !boundId) return;

    if (globallyOpenConnectionIds.includes(boundId)) {
      hasBeenOpenRef.current = true;
      return;
    }
    if (hasBeenOpenRef.current) {
      void getCurrentWindow().close();
    }
  }, [globallyOpenConnectionIds]);
}
