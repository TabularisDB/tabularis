import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useConnectionManager } from "./useConnectionManager";

/**
 * When the app is launched in a dedicated connection window
 * (`/?connect=<connectionId>`, opened via the sidebar "Open in New Window"
 * action), auto-connect to that connection on startup and jump to the editor.
 *
 * Runs at most once per window; the query param is stripped afterwards so a
 * refresh or later navigation never re-triggers it.
 */
export function useAutoConnectFromUrl() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleConnect } = useConnectionManager();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    const connectionId = searchParams.get("connect");
    if (!connectionId) return;

    handledRef.current = true;
    void handleConnect(connectionId)
      .then(() => navigate("/editor", { replace: true }))
      .catch(() => {
        // Connection failed; leave the user on the connections view where the
        // error surfaces through the normal connection-manager flow.
        navigate("/", { replace: true });
      });
  }, [searchParams, handleConnect, navigate]);
}
