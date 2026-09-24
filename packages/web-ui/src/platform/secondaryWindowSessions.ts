import type { PlatformCapabilities } from "./capabilities";
import { BROWSER_ROUTES } from "../routing";
import type {
  ResultsSyncPayload,
  ResultsWindowAction,
} from "../utils/resultsWindowSync";

export const JSON_VIEWER_SESSION_REQUEST_EVENT =
  "secondary-window:json-session-request";
export const JSON_VIEWER_SESSION_DATA_EVENT =
  "secondary-window:json-session-data";
export const JSON_VIEWER_SESSION_SAVED_EVENT =
  "secondary-window:json-session-saved";
export const JSON_VIEWER_SESSION_CLOSED_EVENT =
  "secondary-window:json-session-closed";
export const JSON_VIEWER_SESSION_EXPIRED_EVENT =
  "secondary-window:json-session-expired";
export const RESULTS_CLOSE_REQUEST_EVENT =
  "secondary-window:results-close-request";

export interface ResultsSessionRequest {
  readonly sessionId: string;
}

export interface ResultsSessionSnapshot {
  readonly sessionId: string;
  readonly payload: ResultsSyncPayload;
}

export interface ResultsSessionAction {
  readonly sessionId: string;
  readonly action: ResultsWindowAction;
}

export type ResultsCloseRequest = ResultsSessionRequest;
export type ResultsSessionClosed = ResultsSessionRequest;

export interface JsonViewerSession {
  readonly value: unknown;
  readonly originalValue: unknown;
  readonly columnName: string;
  readonly rowLabel?: string | null;
  readonly readOnly: boolean;
  readonly cellKey?: string | null;
}

export interface JsonViewerSessionRequest {
  readonly sessionId: string;
}

export interface JsonViewerSessionData {
  readonly sessionId: string;
  readonly session: JsonViewerSession;
}

export interface JsonViewerSessionSaved {
  readonly sessionId: string;
  readonly value: unknown;
}

export interface JsonViewerSessionClosed {
  readonly sessionId: string;
}

export type JsonViewerSessionExpired = JsonViewerSessionRequest;
export type JsonViewerSavedHandler = (value: unknown) => void;

export interface JsonViewerSessionHostOptions {
  readonly createSessionId?: () => string;
}

interface HostedJsonViewerSession {
  session: JsonViewerSession;
  onSaved?: JsonViewerSavedHandler;
}

export class JsonViewerSessionHost {
  private readonly platform: PlatformCapabilities;
  private readonly createSessionId: () => string;
  private readonly sessions = new Map<string, HostedJsonViewerSession>();
  private readonly cellSessions = new Map<string, string>();
  private readonly ready: Promise<void>;
  private unsubscribers: Array<() => void> = [];

  constructor(
    platform: PlatformCapabilities,
    options: JsonViewerSessionHostOptions = {},
  ) {
    this.platform = platform;
    this.createSessionId = options.createSessionId ?? (() => crypto.randomUUID());
    this.ready = this.subscribe();
  }

  async open(
    session: JsonViewerSession,
    onSaved?: JsonViewerSavedHandler,
  ): Promise<string> {
    await this.ready;

    const existingSessionId = session.cellKey
      ? this.cellSessions.get(session.cellKey)
      : undefined;
    const sessionId = existingSessionId ?? this.createSessionId();
    const existingSession = existingSessionId
      ? this.sessions.get(existingSessionId)
      : undefined;

    const hostedSession: HostedJsonViewerSession = {
      session: existingSession
        ? { ...existingSession.session, value: session.value }
        : session,
      onSaved: onSaved ?? existingSession?.onSaved,
    };
    this.sessions.set(sessionId, hostedSession);
    if (session.cellKey) this.cellSessions.set(session.cellKey, sessionId);

    try {
      await this.platform.openRoute({
        route: `${BROWSER_ROUTES.jsonViewer}?session=${encodeURIComponent(sessionId)}`,
        target: "new",
        label: `json-viewer-${sessionId}`,
        title: buildJsonViewerTitle(session),
        window: {
          width: 900,
          height: 700,
          minWidth: 600,
          minHeight: 400,
        },
      });
      return sessionId;
    } catch (cause) {
      if (existingSession) this.sessions.set(sessionId, existingSession);
      else this.remove(sessionId, session.cellKey);
      throw cause;
    }
  }

  async dispose(): Promise<void> {
    await this.ready;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.sessions.clear();
    this.cellSessions.clear();
  }

  private async subscribe(): Promise<void> {
    this.unsubscribers = await Promise.all([
      this.platform.subscribeRouteEvent<JsonViewerSessionRequest>(
        JSON_VIEWER_SESSION_REQUEST_EVENT,
        ({ sessionId }) => {
          const hosted = this.sessions.get(sessionId);
          if (hosted) {
            void this.platform.publishRouteEvent<JsonViewerSessionData>(
              JSON_VIEWER_SESSION_DATA_EVENT,
              { sessionId, session: hosted.session },
            );
          } else {
            void this.platform.publishRouteEvent<JsonViewerSessionExpired>(
              JSON_VIEWER_SESSION_EXPIRED_EVENT,
              { sessionId },
            );
          }
        },
      ),
      this.platform.subscribeRouteEvent<JsonViewerSessionSaved>(
        JSON_VIEWER_SESSION_SAVED_EVENT,
        ({ sessionId, value }) => {
          const hosted = this.sessions.get(sessionId);
          if (!hosted) return;
          hosted.onSaved?.(value);
          this.remove(sessionId, hosted.session.cellKey);
        },
      ),
      this.platform.subscribeRouteEvent<JsonViewerSessionClosed>(
        JSON_VIEWER_SESSION_CLOSED_EVENT,
        ({ sessionId }) => {
          const hosted = this.sessions.get(sessionId);
          if (hosted) this.remove(sessionId, hosted.session.cellKey);
        },
      ),
    ]);
  }

  private remove(sessionId: string, cellKey?: string | null): void {
    this.sessions.delete(sessionId);
    if (cellKey && this.cellSessions.get(cellKey) === sessionId) {
      this.cellSessions.delete(cellKey);
    }
  }
}

const hosts = new WeakMap<PlatformCapabilities, JsonViewerSessionHost>();

export function getJsonViewerSessionHost(
  platform: PlatformCapabilities,
): JsonViewerSessionHost {
  const existing = hosts.get(platform);
  if (existing) return existing;
  const host = new JsonViewerSessionHost(platform);
  hosts.set(platform, host);
  return host;
}

function buildJsonViewerTitle(session: JsonViewerSession): string {
  const column = session.columnName.trim();
  const row = session.rowLabel?.trim();
  if (column && row) return `${column} · ${row} — JSON Viewer`;
  if (column) return `${column} — JSON Viewer`;
  return "JSON Viewer";
}
