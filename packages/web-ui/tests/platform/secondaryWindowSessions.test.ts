import { describe, expect, it, vi } from "vitest";
import type {
  OpenConnectionRouteRequest,
  OpenRouteRequest,
  PlatformCapabilities,
  RouteEventHandler,
  UnsubscribeRouteEvent,
} from "../../src/platform/capabilities";
import {
  JSON_VIEWER_SESSION_CLOSED_EVENT,
  JSON_VIEWER_SESSION_DATA_EVENT,
  JSON_VIEWER_SESSION_EXPIRED_EVENT,
  JSON_VIEWER_SESSION_REQUEST_EVENT,
  JSON_VIEWER_SESSION_SAVED_EVENT,
  JsonViewerSessionHost,
  type JsonViewerSessionData,
  type JsonViewerSessionExpired,
  type JsonViewerSessionRequest,
  type JsonViewerSessionSaved,
} from "../../src/platform/secondaryWindowSessions";
import {
  buildConnectionRoute,
  buildResultsWindowRoute,
  buildSchemaDiagramRoute,
  buildVisualExplainRoute,
} from "../../src/routing";

class RouteEventPlatformFixture {
  readonly openRoute = vi.fn<(request: OpenRouteRequest) => Promise<void>>(
    async () => {},
  );
  readonly listeners = new Map<string, Set<RouteEventHandler<unknown>>>();

  async publishRouteEvent<T>(event: string, payload: T): Promise<void> {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  async subscribeRouteEvent<T>(
    event: string,
    handler: RouteEventHandler<T>,
  ): Promise<UnsubscribeRouteEvent> {
    const listeners = this.listeners.get(event) ?? new Set();
    const listener = handler as RouteEventHandler<unknown>;
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  asPlatform(): PlatformCapabilities {
    return {
      openRoute: this.openRoute,
      publishRouteEvent: this.publishRouteEvent.bind(this),
      subscribeRouteEvent: this.subscribeRouteEvent.bind(this),
      openConnectionRoute: async (_request: OpenConnectionRouteRequest) => {},
    } as PlatformCapabilities;
  }
}

describe("secondary window routes", () => {
  it("builds refresh-safe routes with opaque session identifiers", () => {
    expect(buildResultsWindowRoute("result/session")).toBe(
      "/results-window?session=result%2Fsession",
    );
    expect(buildConnectionRoute("connection/id")).toBe(
      "/connections?connect=connection%2Fid&standalone=connection",
    );
  });

  it("encodes schema diagrams and visual explain deep links", () => {
    expect(
      buildSchemaDiagramRoute({
        connectionId: "connection 1",
        connectionName: "Local DB",
        databaseName: "main",
        schema: "public data",
        focusTable: "users",
      }),
    ).toBe(
      "/schema-diagram?connectionId=connection+1&connectionName=Local+DB&databaseName=main&schema=public+data&focusTable=users",
    );
    expect(buildVisualExplainRoute("connection 1", "select * from users")).toMatch(
      /^\/visual-explain\?connection=connection%201&query=/,
    );
  });
});

describe("JsonViewerSessionHost", () => {
  it("shares session data and returns saved values across route contexts", async () => {
    const fixture = new RouteEventPlatformFixture();
    const platform = fixture.asPlatform();
    const onSaved = vi.fn();
    const host = new JsonViewerSessionHost(platform, {
      createSessionId: () => "json-session-1",
    });
    const received: JsonViewerSessionData[] = [];
    await platform.subscribeRouteEvent<JsonViewerSessionData>(
      JSON_VIEWER_SESSION_DATA_EVENT,
      (payload) => received.push(payload),
    );

    await expect(
      host.open(
        {
          value: { edited: false },
          originalValue: { edited: false },
          columnName: "metadata",
          rowLabel: "id=1",
          readOnly: false,
          cellKey: "pk:1:metadata",
        },
        onSaved,
      ),
    ).resolves.toBe("json-session-1");
    expect(fixture.openRoute).toHaveBeenCalledWith({
      route: "/json-viewer?session=json-session-1",
      target: "new",
      label: "json-viewer-json-session-1",
      title: "metadata · id=1 — JSON Viewer",
      window: { width: 900, height: 700, minWidth: 600, minHeight: 400 },
    });

    await platform.publishRouteEvent<JsonViewerSessionRequest>(
      JSON_VIEWER_SESSION_REQUEST_EVENT,
      { sessionId: "json-session-1" },
    );
    expect(received).toEqual([
      {
        sessionId: "json-session-1",
        session: {
          value: { edited: false },
          originalValue: { edited: false },
          columnName: "metadata",
          rowLabel: "id=1",
          readOnly: false,
          cellKey: "pk:1:metadata",
        },
      },
    ]);

    await platform.publishRouteEvent<JsonViewerSessionSaved>(
      JSON_VIEWER_SESSION_SAVED_EVENT,
      { sessionId: "json-session-1", value: { edited: true } },
    );
    expect(onSaved).toHaveBeenCalledWith({ edited: true });

    const expired: JsonViewerSessionExpired[] = [];
    await platform.subscribeRouteEvent<JsonViewerSessionExpired>(
      JSON_VIEWER_SESSION_EXPIRED_EVENT,
      (payload) => expired.push(payload),
    );
    await platform.publishRouteEvent<JsonViewerSessionRequest>(
      JSON_VIEWER_SESSION_REQUEST_EVENT,
      { sessionId: "json-session-1" },
    );
    expect(expired).toEqual([{ sessionId: "json-session-1" }]);
    await host.dispose();
  });

  it("expires cancelled sessions and reuses a live cell session", async () => {
    const fixture = new RouteEventPlatformFixture();
    const platform = fixture.asPlatform();
    const ids = ["json-session-1", "json-session-2"];
    const host = new JsonViewerSessionHost(platform, {
      createSessionId: () => ids.shift() ?? "unexpected",
    });
    const base = {
      value: { version: 1 },
      originalValue: { version: 1 },
      columnName: "metadata",
      readOnly: false,
      cellKey: "pk:1:metadata",
    };

    await expect(host.open(base)).resolves.toBe("json-session-1");
    await expect(
      host.open({ ...base, value: { version: 2 } }),
    ).resolves.toBe("json-session-1");
    expect(fixture.openRoute).toHaveBeenCalledTimes(2);

    await platform.publishRouteEvent(
      JSON_VIEWER_SESSION_CLOSED_EVENT,
      { sessionId: "json-session-1" },
    );
    await expect(host.open(base)).resolves.toBe("json-session-2");
    await host.dispose();
  });
});
