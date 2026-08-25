// Pure helpers used by the AI activity panel and approval modal.
// Kept dependency-free so they can be unit tested in isolation.

import type {
  AiActivityEvent,
  AiActivityStatus,
  AiNotebookExport,
  AiQueryKind,
  AiSessionSummary,
  PendingApproval,
} from "../types/ai";

export type SortDirection = "asc" | "desc";

export type EventSortField =
  | "timestamp"
  | "tool"
  | "connection"
  | "kind"
  | "duration"
  | "status";

export type SessionSortField = "started" | "events" | "runQueries";

export interface BadgeStyle {
  bg: string;
  text: string;
  border: string;
}

const STATUS_STYLES: Record<AiActivityStatus, BadgeStyle> = {
  success: {
    bg: "bg-green-900/20",
    text: "text-green-400",
    border: "border-green-900/40",
  },
  blocked_readonly: {
    bg: "bg-yellow-900/20",
    text: "text-yellow-400",
    border: "border-yellow-900/40",
  },
  blocked_pending_approval: {
    bg: "bg-purple-900/20",
    text: "text-purple-400",
    border: "border-purple-900/40",
  },
  denied: {
    bg: "bg-red-900/20",
    text: "text-red-400",
    border: "border-red-900/40",
  },
  error: {
    bg: "bg-red-900/20",
    text: "text-red-400",
    border: "border-red-900/40",
  },
  timeout: {
    bg: "bg-orange-900/20",
    text: "text-orange-400",
    border: "border-orange-900/40",
  },
};

const QUERY_KIND_STYLES: Record<AiQueryKind, BadgeStyle> = {
  select: {
    bg: "bg-blue-900/20",
    text: "text-blue-400",
    border: "border-blue-900/40",
  },
  write: {
    bg: "bg-yellow-900/20",
    text: "text-yellow-400",
    border: "border-yellow-900/40",
  },
  ddl: {
    bg: "bg-orange-900/20",
    text: "text-orange-400",
    border: "border-orange-900/40",
  },
  unknown: {
    bg: "bg-surface-secondary",
    text: "text-muted",
    border: "border-default",
  },
};

const FALLBACK_STYLE: BadgeStyle = {
  bg: "bg-surface-secondary",
  text: "text-muted",
  border: "border-default",
};

export function getStatusBadgeStyle(status: string): BadgeStyle {
  return STATUS_STYLES[status as AiActivityStatus] ?? FALLBACK_STYLE;
}

export function getQueryKindBadgeStyle(kind: string | null): BadgeStyle {
  if (!kind) return FALLBACK_STYLE;
  return QUERY_KIND_STYLES[kind as AiQueryKind] ?? FALLBACK_STYLE;
}

export function truncateQuery(query: string | null, maxLen = 80): string {
  if (!query) return "";
  const oneLine = query.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen)}…`;
}

export function formatDurationMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(2)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}

// Backend stores timestamps as RFC3339 in UTC via `chrono::Utc::now().to_rfc3339()`,
// which emits a numeric `+00:00` offset with fractional seconds
// (e.g. `2026-04-24T10:00:00.123456789+00:00`). `new Date()` parses both that and
// the `Z` form as UTC. These helpers render them in the chosen display timezone:
// `timeZone` is an optional IANA name (e.g. "Asia/Tokyo"); when omitted, "auto",
// or unrecognised, the OS local timezone is used.
type LocalTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function localTimeParts(iso: string, timeZone?: string): LocalTimeParts | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zone = timeZone && timeZone !== "auto" ? timeZone : undefined;
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: zone }).formatToParts(d);
  } catch {
    // Unrecognised IANA name — fall back to the OS local timezone.
    parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(d);
  }
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function formatLocalTimestamp(iso: string, timeZone?: string): string {
  const p = localTimeParts(iso, timeZone);
  if (!p) return iso;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function formatLocalTime(iso: string, timeZone?: string): string {
  const p = localTimeParts(iso, timeZone);
  if (!p) return iso;
  return `${p.hour}:${p.minute}:${p.second}`;
}

export function eventsToCsvLines(events: AiActivityEvent[]): string[] {
  const header = [
    "id",
    "session_id",
    "timestamp",
    "tool",
    "connection_name",
    "query_kind",
    "duration_ms",
    "status",
    "rows",
    "error",
  ].join(",");
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = events.map((e) =>
    [
      escape(e.id),
      escape(e.sessionId),
      escape(e.timestamp),
      escape(e.tool),
      escape(e.connectionName),
      escape(e.queryKind),
      escape(e.durationMs),
      escape(e.status),
      escape(e.rows),
      escape(e.error),
    ].join(","),
  );
  return [header, ...rows];
}

/// Convert the backend export shape to a `NotebookFile`-compatible payload
/// that can be passed to the existing `save_notebook` / notebook editor.
export function notebookFileFromExport(
  exportData: AiNotebookExport,
): NotebookFilePayload {
  return {
    version: exportData.version,
    title: exportData.title,
    createdAt: exportData.createdAt,
    cells: exportData.cells.map((c) => ({
      type: c.type,
      content: c.content,
      ...(c.name !== undefined && { name: c.name }),
      ...(c.schema !== undefined && { schema: c.schema }),
    })),
  };
}

/// Minimal NotebookFile shape — kept here to avoid importing the larger
/// NotebookFile type into a leaf utility module.
export interface NotebookFilePayload {
  version: number;
  title: string;
  createdAt: string;
  cells: Array<{
    type: "sql" | "markdown";
    content: string;
    name?: string;
    schema?: string;
  }>;
}

/// Build a default i18n filename for a notebook export, e.g.
/// `ai-session-2026-04-24-claude-desktop.tabularis-notebook`.
export function defaultExportFilename(
  sessionId: string,
  exportData: AiNotebookExport,
  timeZone?: string,
): string {
  const dateOnly = formatLocalTimestamp(exportData.createdAt, timeZone).slice(0, 10);
  const slug = sessionId.slice(0, 8);
  return `ai-session-${dateOnly}-${slug}.tabularis-notebook`;
}

/// Group events by session id, preserving the original order.
export function groupBySession(
  events: AiActivityEvent[],
): Map<string, AiActivityEvent[]> {
  const map = new Map<string, AiActivityEvent[]>();
  for (const ev of events) {
    const list = map.get(ev.sessionId) ?? [];
    list.push(ev);
    map.set(ev.sessionId, list);
  }
  return map;
}

/// Build a deep-link URL pointing at the Visual Explain page with a query
/// pre-populated. The query is base64url-encoded so it survives URL escaping.
export function buildVisualExplainDeepLink(
  connectionId: string,
  query: string,
): string {
  return `/visual-explain?connection=${encodeURIComponent(
    connectionId,
  )}&query=${base64UrlEncode(query)}`;
}

export function parseVisualExplainDeepLink(search: string): {
  connectionId: string | null;
  query: string | null;
} {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const connectionId = params.get("connection");
  const encoded = params.get("query");
  const query = encoded ? base64UrlDecode(encoded) : null;
  return { connectionId, query };
}

function base64UrlEncode(s: string): string {
  const bytes =
    typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(s)
      : Uint8Array.from(s, (c) => c.charCodeAt(0));
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  let padded = s.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4 !== 0) padded += "=";
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return typeof TextDecoder !== "undefined"
    ? new TextDecoder().decode(bytes)
    : binary;
}

/// Returns true when the pending approval would be considered destructive
/// (write or DDL). Use to drive UI emphasis (red border, etc).
export function isDestructiveApproval(p: PendingApproval): boolean {
  return p.queryKind === "write" || p.queryKind === "ddl" || p.queryKind === "unknown";
}

const QUERY_KIND_ORDER: Record<AiQueryKind, number> = {
  select: 0,
  write: 1,
  ddl: 2,
  unknown: 3,
};

const STATUS_ORDER: Record<AiActivityStatus, number> = {
  success: 0,
  blocked_readonly: 1,
  blocked_pending_approval: 2,
  denied: 3,
  error: 4,
  timeout: 5,
};

// Returns 0 when both values are present, otherwise a non-zero sentinel that
// the caller propagates *without* flipping for direction (nulls always sort
// last in both ASC and DESC).
function nullsLast<T>(
  a: T | null | undefined,
  b: T | null | undefined,
): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return 0;
}

function applyDirection(cmp: number, dir: SortDirection): number {
  return dir === "asc" ? cmp : -cmp;
}

/// Returns a new array of events sorted by the given field/direction. Stable
/// for equal keys (preserves the input order). Pure: never mutates `events`.
export function sortAiEvents(
  events: AiActivityEvent[],
  field: EventSortField,
  direction: SortDirection,
): AiActivityEvent[] {
  const decorated = events.map((ev, i) => ({ ev, i }));
  decorated.sort((a, b) => {
    let cmp = 0;
    let nullCmp = 0;
    switch (field) {
      case "timestamp":
        cmp = a.ev.timestamp.localeCompare(b.ev.timestamp);
        break;
      case "tool":
        cmp = a.ev.tool.localeCompare(b.ev.tool);
        break;
      case "connection":
        nullCmp = nullsLast(a.ev.connectionName, b.ev.connectionName);
        if (nullCmp !== 0) return nullCmp;
        cmp = (a.ev.connectionName ?? "").localeCompare(
          b.ev.connectionName ?? "",
        );
        break;
      case "kind":
        nullCmp = nullsLast(a.ev.queryKind, b.ev.queryKind);
        if (nullCmp !== 0) return nullCmp;
        cmp =
          (QUERY_KIND_ORDER[a.ev.queryKind as AiQueryKind] ?? 99) -
          (QUERY_KIND_ORDER[b.ev.queryKind as AiQueryKind] ?? 99);
        break;
      case "duration":
        cmp = a.ev.durationMs - b.ev.durationMs;
        break;
      case "status":
        cmp = (STATUS_ORDER[a.ev.status] ?? 99) - (STATUS_ORDER[b.ev.status] ?? 99);
        break;
    }
    if (cmp === 0) return a.i - b.i;
    return applyDirection(cmp, direction);
  });
  return decorated.map((d) => d.ev);
}

/// Returns a new array of sessions sorted by the given field/direction.
/// Stable for equal keys.
export function sortAiSessions(
  sessions: AiSessionSummary[],
  field: SessionSortField,
  direction: SortDirection,
): AiSessionSummary[] {
  const decorated = sessions.map((s, i) => ({ s, i }));
  decorated.sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case "started":
        cmp = a.s.startedAt.localeCompare(b.s.startedAt);
        break;
      case "events":
        cmp = a.s.eventCount - b.s.eventCount;
        break;
      case "runQueries":
        cmp = a.s.runQueryCount - b.s.runQueryCount;
        break;
    }
    if (cmp === 0) return a.i - b.i;
    return applyDirection(cmp, direction);
  });
  return decorated.map((d) => d.s);
}

/// Case-insensitive substring match against the parts of a session a user
/// would reasonably type into a search box (id, client hint, connection
/// names). Empty/whitespace queries match everything.
export function sessionMatchesSearch(
  session: AiSessionSummary,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (session.sessionId.toLowerCase().includes(q)) return true;
  if (session.clientHint && session.clientHint.toLowerCase().includes(q)) {
    return true;
  }
  return session.connectionNames.some((c) => c.toLowerCase().includes(q));
}
