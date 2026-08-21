import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { emit, listen } from "@tauri-apps/api/event";
import { MultiResultPanel } from "../components/ui/MultiResultPanel";
import { ResultEntryContent } from "../components/ui/ResultEntryContent";
import {
  RESULTS_SYNC_EVENT,
  RESULTS_ACTION_EVENT,
  RESULTS_READY_EVENT,
  hasMultiResults,
  singleResultToEntry,
  type ResultsSyncPayload,
  type ResultsWindowAction,
} from "../utils/resultsWindowSync";

/**
 * Detached query-results window, bound to a single editor tab (its id comes from
 * the `?tab=` query param). It renders that tab's results (pushed from the main
 * window via {@link RESULTS_SYNC_EVENT}, filtered by `tabId`) and forwards user
 * actions back, tagged with its `tabId`. The main window owns all query/DB
 * logic; this window holds no query state of its own.
 */
export const ResultsWindowPage = () => {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const tabId = searchParams.get("tab") ?? "";
  const [payload, setPayload] = useState<ResultsSyncPayload | null>(null);

  // Receive result snapshots for this tab from the main window.
  useEffect(() => {
    if (!tabId) return;
    const unlistenPromise = listen<ResultsSyncPayload>(
      RESULTS_SYNC_EVENT,
      (event) => {
        if (event.payload.tabId === tabId) setPayload(event.payload);
      },
    );
    // Ask the main window to send this tab's current state now that we're mounted.
    emit(RESULTS_READY_EVENT, { tabId });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [tabId]);

  const send = useCallback(
    (action: ResultsWindowAction) => {
      emit(RESULTS_ACTION_EVENT, { tabId, action });
    },
    [tabId],
  );

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
