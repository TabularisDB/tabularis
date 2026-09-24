import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { EditorErrorBoundary } from "../components/ui/EditorErrorBoundary";
import { useDatabase } from "../hooks/useDatabase";
import { BROWSER_ROUTES, buildEditorRoute } from "../routing";
import { Editor } from "./Editor";

export function ConnectionEditorRoute() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const navigate = useNavigate();
  const {
    activeConnectionId,
    connect,
    isConnectionOpen,
    switchConnection,
  } = useDatabase();
  const handledConnectionIdRef = useRef<string | null>(null);
  const currentRouteConnectionIdRef = useRef(connectionId);

  useEffect(() => {
    currentRouteConnectionIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId) {
      if (activeConnectionId) {
        navigate(buildEditorRoute(activeConnectionId), { replace: true });
      } else {
        navigate(BROWSER_ROUTES.connections, { replace: true });
      }
      return;
    }

    if (handledConnectionIdRef.current !== connectionId) {
      handledConnectionIdRef.current = connectionId;

      if (isConnectionOpen(connectionId)) {
        switchConnection(connectionId);
      } else {
        void connect(connectionId).catch(() => {
          if (currentRouteConnectionIdRef.current === connectionId) {
            navigate(BROWSER_ROUTES.connections, { replace: true });
          }
        });
      }
      return;
    }

    if (activeConnectionId && activeConnectionId !== connectionId) {
      navigate(buildEditorRoute(activeConnectionId), { replace: true });
    }
  }, [
    activeConnectionId,
    connect,
    connectionId,
    isConnectionOpen,
    navigate,
    switchConnection,
  ]);

  return (
    <EditorErrorBoundary>
      <Editor />
    </EditorErrorBoundary>
  );
}
