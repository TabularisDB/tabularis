import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteEventHandler } from "../../src/platform/capabilities";
import {
  JSON_VIEWER_SESSION_DATA_EVENT,
  JSON_VIEWER_SESSION_REQUEST_EVENT,
  JSON_VIEWER_SESSION_SAVED_EVENT,
  type JsonViewerSessionData,
} from "../../src/platform/secondaryWindowSessions";
import {
  RESULTS_READY_EVENT,
  RESULTS_SYNC_EVENT,
  type ResultsSyncPayload,
} from "../../src/utils/resultsWindowSync";

const listeners = new Map<string, Set<RouteEventHandler<unknown>>>();
const publishRouteEvent = vi.fn(
  async (event: string, payload: unknown): Promise<void> => {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  },
);
const closeRoute = vi.fn(async () => {});
const platform = {
  publishRouteEvent,
  closeRoute,
  subscribeRouteEvent: async <T,>(
    event: string,
    handler: RouteEventHandler<T>,
  ) => {
    const eventListeners = listeners.get(event) ?? new Set();
    const listener = handler as RouteEventHandler<unknown>;
    eventListeners.add(listener);
    listeners.set(event, eventListeners);
    return () => eventListeners.delete(listener);
  },
};

vi.mock("../../src/hooks/usePlatformCapabilities", () => ({
  usePlatformCapabilities: () => platform,
}));

vi.mock("../../src/components/ui/MultiResultPanel", () => ({
  MultiResultPanel: () => <div>multi result</div>,
}));

vi.mock("../../src/components/ui/ResultEntryContent", () => ({
  ResultEntryContent: () => <div>single result</div>,
}));

vi.mock("../../src/components/ui/JsonInput", () => ({
  JsonInput: () => <div>json editor</div>,
}));

// eslint-disable-next-line import/first
import { JsonViewerPage } from "../../src/pages/JsonViewerPage";
// eslint-disable-next-line import/first
import { ResultsWindowPage } from "../../src/pages/ResultsWindowPage";

const resultPayload: ResultsSyncPayload = {
  tabId: "result-session",
  tabTitle: "Query",
  query: "SELECT 1",
  result: { columns: ["value"], rows: [[1]], affected_rows: 0 },
  error: "",
  executionTime: 1,
  isLoading: false,
  activeTable: null,
  connectionId: "connection-1",
  copyFormat: "csv",
  csvDelimiter: ",",
  csvIncludeHeaders: true,
};

beforeEach(() => {
  listeners.clear();
  publishRouteEvent.mockClear();
  closeRoute.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ResultsWindowPage", () => {
  it("requests and renders a shared result session in a new route", async () => {
    render(
      <MemoryRouter initialEntries={["/results-window?session=result-session"]}>
        <ResultsWindowPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(publishRouteEvent).toHaveBeenCalledWith(RESULTS_READY_EVENT, {
        sessionId: "result-session",
      }),
    );
    await act(async () => {
      await platform.publishRouteEvent(RESULTS_SYNC_EVENT, {
        sessionId: "result-session",
        payload: resultPayload,
      });
    });

    expect(screen.getByText("single result")).toBeInTheDocument();
  });

  it("clearly expires a refreshed route when its owner is gone", async () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={["/results-window?session=missing-session"]}>
        <ResultsWindowPage />
      </MemoryRouter>,
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(
      screen.getByText(/secondaryWindows.sessionExpired/i),
    ).toBeInTheDocument();
  });
});

describe("JsonViewerPage", () => {
  it("loads and completes a shared JSON session", async () => {
    render(
      <MemoryRouter initialEntries={["/json-viewer?session=json-session"]}>
        <JsonViewerPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(publishRouteEvent).toHaveBeenCalledWith(
        JSON_VIEWER_SESSION_REQUEST_EVENT,
        { sessionId: "json-session" },
      ),
    );
    const data: JsonViewerSessionData = {
      sessionId: "json-session",
      session: {
        value: { saved: true },
        originalValue: { saved: false },
        columnName: "metadata",
        readOnly: false,
      },
    };
    await act(async () => {
      await platform.publishRouteEvent(JSON_VIEWER_SESSION_DATA_EVENT, data);
    });

    expect(screen.getByText("json editor")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "jsonViewer.save" }),
    );
    await waitFor(() =>
      expect(publishRouteEvent).toHaveBeenCalledWith(
        JSON_VIEWER_SESSION_SAVED_EVENT,
        { sessionId: "json-session", value: { saved: true } },
      ),
    );
    expect(closeRoute).toHaveBeenCalledOnce();
  });
});
