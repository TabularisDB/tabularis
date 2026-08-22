import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { JsonInput } from "../components/ui/JsonInput";
import { usePlatformCapabilities } from "../hooks/usePlatformCapabilities";
import {
  JSON_VIEWER_SESSION_CLOSED_EVENT,
  JSON_VIEWER_SESSION_DATA_EVENT,
  JSON_VIEWER_SESSION_EXPIRED_EVENT,
  JSON_VIEWER_SESSION_REQUEST_EVENT,
  JSON_VIEWER_SESSION_SAVED_EVENT,
  type JsonViewerSession,
  type JsonViewerSessionClosed,
  type JsonViewerSessionData,
  type JsonViewerSessionExpired,
  type JsonViewerSessionRequest,
  type JsonViewerSessionSaved,
} from "../platform/secondaryWindowSessions";

const SESSION_RESPONSE_TIMEOUT_MS = 2_000;

export const JsonViewerPage = () => {
  const { t } = useTranslation();
  const platform = usePlatformCapabilities();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session") ?? "";
  const completedRef = useRef(false);

  const [session, setSession] = useState<JsonViewerSession | null>(null);
  const [currentValue, setCurrentValue] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let unsubscribers: Array<() => void> = [];

    void (async () => {
      try {
        unsubscribers = await Promise.all([
          platform.subscribeRouteEvent<JsonViewerSessionData>(
            JSON_VIEWER_SESSION_DATA_EVENT,
            ({ sessionId: receivedId, session: receivedSession }) => {
              if (cancelled || receivedId !== sessionId) return;
              if (timeout) clearTimeout(timeout);
              setError(null);
              setSession(receivedSession);
              setCurrentValue(receivedSession.value);
            },
          ),
          platform.subscribeRouteEvent<JsonViewerSessionExpired>(
            JSON_VIEWER_SESSION_EXPIRED_EVENT,
            ({ sessionId: expiredId }) => {
              if (cancelled || expiredId !== sessionId) return;
              if (timeout) clearTimeout(timeout);
              setError(
                t("jsonViewer.sessionExpired", {
                  defaultValue:
                    "This JSON viewer session expired. Return to the source and open it again.",
                }),
              );
            },
          ),
        ]);
        if (cancelled) {
          for (const unsubscribe of unsubscribers) unsubscribe();
          return;
        }

        timeout = setTimeout(() => {
          setError(
            t("jsonViewer.sessionExpired", {
              defaultValue:
                "This JSON viewer session expired. Return to the source and open it again.",
            }),
          );
        }, SESSION_RESPONSE_TIMEOUT_MS);
        await platform.publishRouteEvent<JsonViewerSessionRequest>(
          JSON_VIEWER_SESSION_REQUEST_EVENT,
          { sessionId },
        );
      } catch (cause) {
        if (!cancelled) setError(String(cause));
      }
    })();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [platform, sessionId, t]);

  const closeSession = useCallback(async () => {
    if (sessionId && !completedRef.current) {
      completedRef.current = true;
      await platform.publishRouteEvent<JsonViewerSessionClosed>(
        JSON_VIEWER_SESSION_CLOSED_EVENT,
        { sessionId },
      );
    }
    await platform.closeRoute();
  }, [platform, sessionId]);

  const handleSave = useCallback(async () => {
    try {
      completedRef.current = true;
      await platform.publishRouteEvent<JsonViewerSessionSaved>(
        JSON_VIEWER_SESSION_SAVED_EVENT,
        { sessionId, value: currentValue },
      );
      await platform.closeRoute();
    } catch (cause) {
      completedRef.current = false;
      setError(String(cause));
    }
  }, [currentValue, platform, sessionId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void closeSession();
    };
    const handlePageHide = () => {
      if (!sessionId || completedRef.current) return;
      completedRef.current = true;
      void platform.publishRouteEvent<JsonViewerSessionClosed>(
        JSON_VIEWER_SESSION_CLOSED_EVENT,
        { sessionId },
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [closeSession, platform, sessionId]);

  const showSave = session && !session.readOnly;
  const displayError =
    error ??
    (!sessionId
      ? t("jsonViewer.noSession", { defaultValue: "No session ID provided" })
      : null);

  return (
    <div className="w-screen h-screen flex flex-col bg-base text-primary">
      <div className="flex-1 min-h-0 p-4">
        {displayError ? (
          <p className="text-red-400 text-sm">{displayError}</p>
        ) : session ? (
          <JsonInput
            value={currentValue}
            originalValue={session.originalValue}
            onChange={setCurrentValue}
            readOnly={session.readOnly}
            className="h-full"
            disableExpand
            fillHeight
          />
        ) : (
          <p className="text-muted text-sm">{t("common.loading")}</p>
        )}
      </div>

      <div className="p-4 border-t border-default bg-elevated/50 flex justify-end gap-3 shrink-0">
        {showSave ? (
          <>
            <button
              type="button"
              onClick={() => void closeSession()}
              className="px-4 py-2 text-secondary hover:text-primary transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {t("jsonViewer.save")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => void closeSession()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t("jsonViewer.close")}
          </button>
        )}
      </div>
    </div>
  );
};
