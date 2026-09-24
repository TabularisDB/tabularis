import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESULTS_CLOSE_REQUEST_EVENT } from "../../src/platform/secondaryWindowSessions";
import { useSecondaryWindows } from "../../src/hooks/useSecondaryWindows";

const openRoute = vi.fn();
const publishRouteEvent = vi.fn();

vi.mock("../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => ({ openRoute, publishRouteEvent }),
}));

describe("useSecondaryWindows", () => {
  beforeEach(() => {
    openRoute.mockReset();
    openRoute.mockResolvedValue(undefined);
    publishRouteEvent.mockReset();
    publishRouteEvent.mockResolvedValue(undefined);
  });

  it("opens results, schema, task manager, and visual explain routes", async () => {
    const { result } = renderHook(() => useSecondaryWindows());

    await result.current.openResultsWindow("result/session", "Query Results");
    await result.current.openSchemaDiagram({
      connectionId: "connection-1",
      connectionName: "Primary",
      databaseName: "main",
      schema: "public",
      focusTable: "users",
    });
    await result.current.openTaskManager();
    await result.current.openVisualExplain("connection-1", "SELECT 1");

    expect(openRoute).toHaveBeenNthCalledWith(1, {
      route: "/results-window?session=result%2Fsession",
      target: "new",
      label: "results-window-result_session",
      title: "Query Results",
      window: { width: 900, height: 600, minWidth: 500, minHeight: 300 },
    });
    expect(openRoute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        route:
          "/schema-diagram?connectionId=connection-1&connectionName=Primary&databaseName=main&schema=public&focusTable=users",
        target: "new",
        label: "er-diagram-connection-1_main_public",
      }),
    );
    expect(openRoute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ route: "/task-manager", label: "task-manager" }),
    );
    expect(openRoute).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        route: expect.stringMatching(
          /^\/visual-explain\?connection=connection-1&query=/,
        ),
        label: "visual-explain",
      }),
    );
  });

  it("asks an opened result route to close by opaque session id", async () => {
    const { result } = renderHook(() => useSecondaryWindows());

    await result.current.closeResultsWindow("result-session");

    expect(publishRouteEvent).toHaveBeenCalledWith(
      RESULTS_CLOSE_REQUEST_EVENT,
      { sessionId: "result-session" },
    );
  });
});
