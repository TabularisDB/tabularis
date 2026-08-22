import { useCallback, useMemo } from "react";
import {
  BROWSER_ROUTES,
  buildResultsWindowRoute,
  buildRouteWindowLabel,
  buildSchemaDiagramRoute,
  buildVisualExplainRoute,
  type SchemaDiagramRouteParams,
} from "../routing";
import { usePlatformCapabilities } from "./usePlatformCapabilities";
import {
  RESULTS_CLOSE_REQUEST_EVENT,
  type ResultsCloseRequest,
} from "../platform/secondaryWindowSessions";

export function useSecondaryWindows() {
  const platform = usePlatformCapabilities();

  const openResultsWindow = useCallback(
    async (sessionId: string, title: string) => {
      await platform.openRoute({
        route: buildResultsWindowRoute(sessionId),
        target: "new",
        label: buildRouteWindowLabel("results-window", sessionId),
        title,
        window: { width: 900, height: 600, minWidth: 500, minHeight: 300 },
      });
    },
    [platform],
  );

  const closeResultsWindow = useCallback(
    async (sessionId: string) => {
      await platform.publishRouteEvent<ResultsCloseRequest>(
        RESULTS_CLOSE_REQUEST_EVENT,
        { sessionId },
      );
    },
    [platform],
  );

  const openSchemaDiagram = useCallback(
    async (params: SchemaDiagramRouteParams) => {
      const schemaLabel = params.schema ?? "";
      await platform.openRoute({
        route: buildSchemaDiagramRoute(params),
        target: "new",
        label: buildRouteWindowLabel(
          "er-diagram",
          params.connectionId,
          params.databaseName,
          schemaLabel,
        ),
        title: `tabularis - ${params.databaseName} (${params.connectionName}${
          params.schema ? `/${params.schema}` : ""
        })`,
        window: { width: 1200, height: 800 },
      });
    },
    [platform],
  );

  const openTaskManager = useCallback(async () => {
    await platform.openRoute({
      route: BROWSER_ROUTES.taskManager,
      target: "new",
      label: "task-manager",
      title: "tabularis - Task Manager",
      window: { width: 900, height: 600, minWidth: 700, minHeight: 450 },
    });
  }, [platform]);

  const openVisualExplain = useCallback(
    async (connectionId: string, query: string) => {
      await platform.openRoute({
        route: buildVisualExplainRoute(connectionId, query),
        target: "new",
        label: "visual-explain",
        title: "tabularis - Visual Explain",
        window: { width: 1280, height: 820, minWidth: 900, minHeight: 600 },
      });
    },
    [platform],
  );

  return useMemo(
    () => ({
      openResultsWindow,
      closeResultsWindow,
      openSchemaDiagram,
      openTaskManager,
      openVisualExplain,
    }),
    [
      closeResultsWindow,
      openResultsWindow,
      openSchemaDiagram,
      openTaskManager,
      openVisualExplain,
    ],
  );
}
