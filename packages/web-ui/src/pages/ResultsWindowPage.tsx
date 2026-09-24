import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { MultiResultPanel } from "../components/ui/MultiResultPanel";
import { ResultEntryContent } from "../components/ui/ResultEntryContent";
import { usePlatformCapabilities } from "../hooks/usePlatformCapabilities";
import {
  RESULTS_CLOSE_REQUEST_EVENT,
  type ResultsCloseRequest,
  type ResultsSessionAction,
  type ResultsSessionClosed,
  type ResultsSessionRequest,
  type ResultsSessionSnapshot,
} from "../platform/secondaryWindowSessions";
import {
  RESULTS_SYNC_EVENT,
  RESULTS_ACTION_EVENT,
  RESULTS_READY_EVENT,
  RESULTS_CLOSED_EVENT,
  hasMultiResults,
  singleResultToEntry,
  type ResultsSyncPayload,
  type ResultsWindowAction,
} from "../utils/resultsWindowSync";

const SESSION_RESPONSE_TIMEOUT_MS = 2_000;

/**
 * Detached query results identified by the `session` route parameter. The
 * source editor remains the owner of query state; route events provide the same
 * snapshot and action contract to native webviews and browser tabs.
 */
export const ResultsWindowPage = () => {
  const { t } = useTranslation();
  const platform = usePlatformCapabilities();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session") ?? "";
  const [payload, setPayload] = useState<ResultsSyncPayload | null>(null);
  const [expired, setExpired] = useState(false);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let unsubscribers: Array<() => void> = [];

    void (async () => {
      try {
        unsubscribers = await Promise.all([
          platform.subscribeRouteEvent<ResultsSessionSnapshot>(
            RESULTS_SYNC_EVENT,
            ({ sessionId: receivedId, payload: nextPayload }) => {
              if (cancelled || receivedId !== sessionId) return;
              if (timeout) clearTimeout(timeout);
              setPayload(nextPayload);
            },
          ),
          platform.subscribeRouteEvent<ResultsCloseRequest>(
            RESULTS_CLOSE_REQUEST_EVENT,
            ({ sessionId: closedSessionId }) => {
              if (cancelled || closedSessionId !== sessionId) return;
              closedRef.current = true;
              void (async () => {
                try {
                  await platform.publishRouteEvent<ResultsSessionClosed>(
                    RESULTS_CLOSED_EVENT,
                    { sessionId },
                  );
                } finally {
                  await platform.closeRoute();
                }
              })().catch(() => {});
            },
          ),
        ]);
        if (cancelled) {
          for (const unsubscribe of unsubscribers) unsubscribe();
          return;
        }
        timeout = setTimeout(
          () => setExpired(true),
          SESSION_RESPONSE_TIMEOUT_MS,
        );
        await platform.publishRouteEvent<ResultsSessionRequest>(
          RESULTS_READY_EVENT,
          { sessionId },
        );
      } catch {
        if (!cancelled) setExpired(true);
      }
    })();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [platform, sessionId]);

  useEffect(() => {
    const handlePageHide = () => {
      if (!sessionId || closedRef.current) return;
      closedRef.current = true;
      void platform.publishRouteEvent<ResultsSessionClosed>(
        RESULTS_CLOSED_EVENT,
        { sessionId },
      );
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [platform, sessionId]);

  const send = useCallback(
    (action: ResultsWindowAction) => {
      void platform.publishRouteEvent<ResultsSessionAction>(
        RESULTS_ACTION_EVENT,
        { sessionId, action },
      );
    },
    [platform, sessionId],
  );

  if (!sessionId || expired) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-elevated text-muted text-sm px-6 text-center">
        {t("secondaryWindows.sessionExpired", {
          defaultValue:
            "This secondary window session expired. Return to the source and open it again.",
        })}
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-elevated text-muted text-sm">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-elevated text-primary overflow-hidden">
      {hasMultiResults(payload) ? (
        <MultiResultPanel
          results={payload.results!}
          activeResultId={payload.activeResultId}
          tabId={payload.tabId}
          connectionId={payload.connectionId}
          copyFormat={payload.copyFormat}
          csvDelimiter={payload.csvDelimiter}
          csvIncludeHeaders={payload.csvIncludeHeaders}
          onSelectResult={(entryId) => send({ type: "select-result", entryId })}
          onRerunEntry={(entryId) => send({ type: "rerun-entry", entryId })}
          onPageChange={(entryId, page) =>
            send({ type: "page-change", entryId, page })
          }
          onCloseEntry={(entryId) => send({ type: "close-entry", entryId })}
          onCloseOtherEntries={(entryId) =>
            send({ type: "close-other-entries", entryId })
          }
          onCloseEntriesToRight={(entryId) =>
            send({ type: "close-entries-to-right", entryId })
          }
          onCloseEntriesToLeft={(entryId) =>
            send({ type: "close-entries-to-left", entryId })
          }
          onCloseAllEntries={() => send({ type: "close-all-entries" })}
          onRenameEntry={(entryId, label) =>
            send({ type: "rename-entry", entryId, label })
          }
        />
      ) : payload.result || payload.error || payload.isLoading ? (
        <ResultEntryContent
          entry={singleResultToEntry(payload)}
          connectionId={payload.connectionId}
          copyFormat={payload.copyFormat}
          csvDelimiter={payload.csvDelimiter}
          csvIncludeHeaders={payload.csvIncludeHeaders}
          onPageChange={(page) =>
            send({ type: "run-query-page", query: payload.query, page })
          }
        />
      ) : (
        <div className="flex items-center justify-center h-full text-surface-tertiary text-sm">
          {t("editor.executePrompt")}
        </div>
      )}
    </div>
  );
};
