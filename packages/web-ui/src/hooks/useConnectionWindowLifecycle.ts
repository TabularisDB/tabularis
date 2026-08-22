import { useEffect, useRef } from "react";
import { useDatabase } from "./useDatabase";
import { usePlatformCapabilities } from "./usePlatformCapabilities";

/**
 * Lifecycle for a dedicated connection window: once its bound connection has
 * been open and then becomes closed anywhere (disconnected here or from another
 * window), close this window. The main window is never a dedicated window, so it
 * is never auto-closed by this hook.
 */
export function useConnectionWindowLifecycle() {
  const platform = usePlatformCapabilities();
  const { globallyOpenConnectionIds } = useDatabase();

  // The connection id this window was launched to show. Captured on first
  // render (before the app navigates away and strips the `?connect=` param).
  const boundIdRef = useRef<string | null | undefined>(undefined);
  if (boundIdRef.current === undefined) {
    const search = new URLSearchParams(window.location.search);
    boundIdRef.current =
      search.get("standalone") === "connection" ? search.get("connect") : null;
  }

  // Guard so we don't close before the connection has finished opening on first
  // launch (the bound id isn't in the open set until connect() completes).
  const hasBeenOpenRef = useRef(false);

  useEffect(() => {
    const boundId = boundIdRef.current;
    if (!boundId) return;

    if (globallyOpenConnectionIds.includes(boundId)) {
      hasBeenOpenRef.current = true;
      return;
    }
    if (hasBeenOpenRef.current) {
      void platform.closeRoute();
    }
  }, [globallyOpenConnectionIds, platform]);
}
