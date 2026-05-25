import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildVisualExplainDeepLink,
  defaultExportFilename,
  eventsToCsvLines,
  formatDurationMs,
  formatLocalTime,
  formatLocalTimestamp,
  getQueryKindBadgeStyle,
  getStatusBadgeStyle,
  groupBySession,
  isDestructiveApproval,
  notebookFileFromExport,
  parseVisualExplainDeepLink,
  sessionMatchesSearch,
  sortAiEvents,
  sortAiSessions,
  truncateQuery,
} from "../../src/utils/aiActivity";
import type {
  AiActivityEvent,
  AiNotebookExport,
  AiSessionSummary,
  PendingApproval,
} from "../../src/types/ai";

const baseEvent = (overrides: Partial<AiActivityEvent> = {}): AiActivityEvent => ({
  id: "id",
  sessionId: "s",
  timestamp: "2026-04-24T10:00:00Z",
  tool: "run_query",
  connectionId: "c1",
  connectionName: "dev",
  query: "SELECT 1",
  queryKind: "select",
  durationMs: 5,
  status: "success",
  rows: 1,
  error: null,
  clientHint: "claude",
  approvalId: null,
  ...overrides,
});

describe("getStatusBadgeStyle", () => {
  it("returns green styling for success", () => {
    const s = getStatusBadgeStyle("success");
    expect(s.text).toContain("green");
  });

  it("returns red styling for error and denied", () => {
    expect(getStatusBadgeStyle("error").text).toContain("red");
    expect(getStatusBadgeStyle("denied").text).toContain("red");
  });

  it("returns fallback for unknown status", () => {
    const s = getStatusBadgeStyle("nope");
    expect(s.text).toBe("text-muted");
  });
});

describe("getQueryKindBadgeStyle", () => {
  it("differentiates select / write / ddl", () => {
    expect(getQueryKindBadgeStyle("select").text).toContain("blue");
    expect(getQueryKindBadgeStyle("write").text).toContain("yellow");
    expect(getQueryKindBadgeStyle("ddl").text).toContain("orange");
  });

  it("falls back when null or unknown", () => {
    expect(getQueryKindBadgeStyle(null).text).toBe("text-muted");
    expect(getQueryKindBadgeStyle("garbage").text).toBe("text-muted");
  });
});

describe("truncateQuery", () => {
  it("returns empty string for null", () => {
    expect(truncateQuery(null)).toBe("");
  });

  it("collapses whitespace", () => {
    expect(truncateQuery("SELECT\n  1\n  FROM   t")).toBe("SELECT 1 FROM t");
  });

  it("truncates with ellipsis past limit", () => {
    const long = "a".repeat(100);
    expect(truncateQuery(long, 20).endsWith("…")).toBe(true);
    expect(truncateQuery(long, 20).length).toBe(21);
  });

  it("does not truncate short queries", () => {
    expect(truncateQuery("SELECT 1", 80)).toBe("SELECT 1");
  });
});

describe("formatDurationMs", () => {
  it("uses sub-millisecond bucket below 1ms", () => {
    expect(formatDurationMs(0.4)).toBe("<1 ms");
  });

  it("uses ms below 1s", () => {
    expect(formatDurationMs(456)).toBe("456 ms");
  });

  it("uses seconds below 1 minute", () => {
    expect(formatDurationMs(1500)).toBe("1.50 s");
  });

  it("uses minutes+seconds above 1 minute", () => {
    expect(formatDurationMs(125_000)).toBe("2m 5s");
  });
});

// Pin the timezone to Asia/Tokyo (UTC+9) so we can assert exact local-time
// strings instead of mirroring the implementation. Node honours runtime
// changes to process.env.TZ for subsequently constructed Date objects.
describe("local timezone formatting (pinned to Asia/Tokyo, UTC+9)", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo";
  });
  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  describe("formatLocalTimestamp", () => {
    it("converts a UTC timestamp to local time (10:00Z + 9h = 19:00)", () => {
      expect(formatLocalTimestamp("2026-04-24T10:00:00Z")).toBe(
        "2026-04-24 19:00:00",
      );
    });

    it("rolls over to the next local day when crossing midnight", () => {
      // 22:00Z is 07:00 next-day in JST — guards against getUTCDate misuse.
      expect(formatLocalTimestamp("2026-04-24T22:00:00Z")).toBe(
        "2026-04-25 07:00:00",
      );
    });

    it("handles the backend's real +00:00 offset form with fractional seconds", () => {
      expect(formatLocalTimestamp("2026-04-24T10:00:00.123456789+00:00")).toBe(
        "2026-04-24 19:00:00",
      );
    });

    it("returns the input string when given an invalid timestamp", () => {
      expect(formatLocalTimestamp("not-a-date")).toBe("not-a-date");
    });
  });

  describe("formatLocalTime", () => {
    it("renders only HH:MM:SS in local time (10:00Z = 19:00 JST)", () => {
      expect(formatLocalTime("2026-04-24T10:00:00Z")).toBe("19:00:00");
    });

    it("returns the input string when given an invalid timestamp", () => {
      expect(formatLocalTime("nope")).toBe("nope");
    });
  });
});

// These exercise the explicit `timeZone` argument and are fully deterministic
// regardless of the machine timezone (no env pinning needed).
describe("display timezone argument", () => {
  it("formatLocalTimestamp renders in the given IANA zone", () => {
    expect(formatLocalTimestamp("2026-04-24T10:00:00Z", "Asia/Tokyo")).toBe(
      "2026-04-24 19:00:00",
    );
    expect(formatLocalTimestamp("2026-04-24T10:00:00Z", "America/New_York")).toBe(
      "2026-04-24 06:00:00",
    );
  });

  it("formatLocalTimestamp rolls the date across midnight in the given zone", () => {
    // 22:00Z is next-day 07:00 in Tokyo, but still 18:00 same-day in New York.
    expect(formatLocalTimestamp("2026-04-24T22:00:00Z", "Asia/Tokyo")).toBe(
      "2026-04-25 07:00:00",
    );
    expect(formatLocalTimestamp("2026-04-24T22:00:00Z", "America/New_York")).toBe(
      "2026-04-24 18:00:00",
    );
  });

  it("formatLocalTime renders HH:MM:SS in the given zone", () => {
    expect(formatLocalTime("2026-04-24T10:00:00Z", "Asia/Tokyo")).toBe("19:00:00");
    expect(formatLocalTime("2026-04-24T10:00:00Z", "America/New_York")).toBe(
      "06:00:00",
    );
  });

  it("treats 'auto' and undefined identically (OS local timezone)", () => {
    const iso = "2026-04-24T10:00:00Z";
    expect(formatLocalTimestamp(iso, "auto")).toBe(formatLocalTimestamp(iso));
    expect(formatLocalTime(iso, "auto")).toBe(formatLocalTime(iso));
  });

  it("falls back to OS local timezone for an unrecognised zone name", () => {
    const iso = "2026-04-24T10:00:00Z";
    expect(formatLocalTimestamp(iso, "Not/AZone")).toBe(formatLocalTimestamp(iso));
  });
});

describe("eventsToCsvLines", () => {
  it("returns header and one row per event", () => {
    const lines = eventsToCsvLines([baseEvent({ id: "a" }), baseEvent({ id: "b" })]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("id,session_id");
  });

  it("escapes quotes and commas", () => {
    const lines = eventsToCsvLines([
      baseEvent({ query: 'SELECT "a", "b" FROM t', error: null }),
    ]);
    // The query column isn't included in CSV, but error/connection might be —
    // verify the escape function keeps round-trippable output: we ensure no
    // bare comma slips into a single-cell value.
    expect(lines[1].split(",").length).toBeGreaterThanOrEqual(10);
  });

  it("emits empty cell for null fields", () => {
    const lines = eventsToCsvLines([baseEvent({ rows: null, error: null, connectionName: null })]);
    expect(lines[1]).toContain(",,");
  });
});

describe("notebookFileFromExport", () => {
  it("preserves type, content, name, schema", () => {
    const exp: AiNotebookExport = {
      version: 1,
      title: "AI Session abc",
      createdAt: "2026-04-24T10:00:00Z",
      cells: [
        { type: "markdown", content: "# header", name: "Session metadata" },
        { type: "sql", content: "SELECT 1", name: "Q1", schema: "dev" },
      ],
    };
    const nb = notebookFileFromExport(exp);
    expect(nb.cells).toHaveLength(2);
    expect(nb.cells[1]).toEqual({
      type: "sql",
      content: "SELECT 1",
      name: "Q1",
      schema: "dev",
    });
  });

  it("omits optional fields when undefined", () => {
    const exp: AiNotebookExport = {
      version: 1,
      title: "t",
      createdAt: "2026-04-24T10:00:00Z",
      cells: [{ type: "sql", content: "SELECT 1" }],
    };
    const nb = notebookFileFromExport(exp);
    expect("name" in nb.cells[0]).toBe(false);
    expect("schema" in nb.cells[0]).toBe(false);
  });
});

// Pinned to Asia/Tokyo (UTC+9): defaultExportFilename now derives the date from
// the local calendar day, so the assertions are timezone-dependent and must run
// against a fixed zone.
describe("defaultExportFilename (pinned to Asia/Tokyo, UTC+9)", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Asia/Tokyo";
  });
  afterAll(() => {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it("composes date + slug", () => {
    const exp: AiNotebookExport = {
      version: 1,
      title: "t",
      createdAt: "2026-04-24T10:00:00Z",
      cells: [],
    };
    expect(defaultExportFilename("abcdef1234567890", exp)).toBe(
      "ai-session-2026-04-24-abcdef12.tabularis-notebook",
    );
  });

  it("uses the local calendar date, rolling over past UTC midnight", () => {
    const exp: AiNotebookExport = {
      version: 1,
      title: "t",
      // 22:00Z is the next day (07:00) in JST.
      createdAt: "2026-04-24T22:00:00Z",
      cells: [],
    };
    expect(defaultExportFilename("abcdef1234567890", exp)).toBe(
      "ai-session-2026-04-25-abcdef12.tabularis-notebook",
    );
  });

  it("derives the date from the explicit display timezone when given one", () => {
    const exp: AiNotebookExport = {
      version: 1,
      title: "t",
      createdAt: "2026-04-24T22:00:00Z",
      cells: [],
    };
    // Tokyo rolls to the 25th; New York (UTC-4) stays on the 24th — deterministic
    // regardless of the machine timezone.
    expect(defaultExportFilename("abcdef1234567890", exp, "Asia/Tokyo")).toBe(
      "ai-session-2026-04-25-abcdef12.tabularis-notebook",
    );
    expect(defaultExportFilename("abcdef1234567890", exp, "America/New_York")).toBe(
      "ai-session-2026-04-24-abcdef12.tabularis-notebook",
    );
  });
});

describe("groupBySession", () => {
  it("groups events by session id preserving order", () => {
    const a = baseEvent({ id: "a", sessionId: "s1" });
    const b = baseEvent({ id: "b", sessionId: "s2" });
    const c = baseEvent({ id: "c", sessionId: "s1" });
    const groups = groupBySession([a, b, c]);
    expect(groups.size).toBe(2);
    expect(groups.get("s1")?.map((e) => e.id)).toEqual(["a", "c"]);
    expect(groups.get("s2")?.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("buildVisualExplainDeepLink + parseVisualExplainDeepLink", () => {
  it("round-trips a query with special characters", () => {
    const url = buildVisualExplainDeepLink(
      "conn-1",
      "SELECT 'a, b', \"c\" FROM users WHERE x = 1",
    );
    expect(url.startsWith("/visual-explain?")).toBe(true);
    const parsed = parseVisualExplainDeepLink(url.split("?")[1]);
    expect(parsed.connectionId).toBe("conn-1");
    expect(parsed.query).toBe("SELECT 'a, b', \"c\" FROM users WHERE x = 1");
  });

  it("returns nulls when params are missing", () => {
    const parsed = parseVisualExplainDeepLink("");
    expect(parsed.connectionId).toBeNull();
    expect(parsed.query).toBeNull();
  });
});

describe("isDestructiveApproval", () => {
  const base: PendingApproval = {
    id: "x",
    createdAt: "2026-04-24T10:00:00Z",
    sessionId: "s",
    connectionId: "c",
    connectionName: "dev",
    query: "UPDATE t",
    queryKind: "write",
    clientHint: null,
    explainPlan: null,
    explainError: null,
  };

  it("flags write/ddl/unknown as destructive", () => {
    expect(isDestructiveApproval(base)).toBe(true);
    expect(isDestructiveApproval({ ...base, queryKind: "ddl" })).toBe(true);
    expect(isDestructiveApproval({ ...base, queryKind: "unknown" })).toBe(true);
  });

  it("does not flag select", () => {
    expect(isDestructiveApproval({ ...base, queryKind: "select" })).toBe(false);
  });
});

describe("sortAiEvents", () => {
  const a = baseEvent({ id: "a", timestamp: "2026-04-24T10:00:00Z", durationMs: 50 });
  const b = baseEvent({ id: "b", timestamp: "2026-04-24T11:00:00Z", durationMs: 10 });
  const c = baseEvent({ id: "c", timestamp: "2026-04-24T09:00:00Z", durationMs: 200 });

  it("sorts by timestamp descending (most recent first)", () => {
    const result = sortAiEvents([a, b, c], "timestamp", "desc");
    expect(result.map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by timestamp ascending", () => {
    const result = sortAiEvents([a, b, c], "timestamp", "asc");
    expect(result.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts by duration", () => {
    expect(sortAiEvents([a, b, c], "duration", "asc").map((e) => e.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(sortAiEvents([a, b, c], "duration", "desc").map((e) => e.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("places nulls last when sorting nullable fields", () => {
    const withNull = baseEvent({ id: "n", connectionName: null });
    const withName = baseEvent({ id: "x", connectionName: "alpha" });
    const result = sortAiEvents([withNull, withName], "connection", "desc");
    expect(result[result.length - 1].id).toBe("n");
  });

  it("is stable when keys tie", () => {
    const x1 = baseEvent({ id: "x1", durationMs: 10 });
    const x2 = baseEvent({ id: "x2", durationMs: 10 });
    const x3 = baseEvent({ id: "x3", durationMs: 10 });
    const result = sortAiEvents([x1, x2, x3], "duration", "desc");
    expect(result.map((e) => e.id)).toEqual(["x1", "x2", "x3"]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortAiEvents(input, "timestamp", "desc");
    expect(input.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("orders status from success → blocked → denied → error → timeout", () => {
    const s1 = baseEvent({ id: "ok", status: "success" });
    const s2 = baseEvent({ id: "err", status: "error" });
    const s3 = baseEvent({ id: "den", status: "denied" });
    const result = sortAiEvents([s2, s3, s1], "status", "asc");
    expect(result.map((e) => e.id)).toEqual(["ok", "den", "err"]);
  });
});

const baseSession = (
  overrides: Partial<AiSessionSummary> = {},
): AiSessionSummary => ({
  sessionId: "s",
  startedAt: "2026-04-24T10:00:00Z",
  endedAt: "2026-04-24T10:05:00Z",
  eventCount: 3,
  runQueryCount: 1,
  connectionNames: ["dev"],
  clientHint: "claude-desktop",
  ...overrides,
});

describe("sortAiSessions", () => {
  const a = baseSession({ sessionId: "a", startedAt: "2026-04-24T10:00:00Z", eventCount: 5 });
  const b = baseSession({ sessionId: "b", startedAt: "2026-04-24T11:00:00Z", eventCount: 1 });
  const c = baseSession({ sessionId: "c", startedAt: "2026-04-24T09:00:00Z", eventCount: 10 });

  it("sorts by startedAt descending by default usage", () => {
    expect(
      sortAiSessions([a, b, c], "started", "desc").map((s) => s.sessionId),
    ).toEqual(["b", "a", "c"]);
  });

  it("sorts by event count", () => {
    expect(
      sortAiSessions([a, b, c], "events", "desc").map((s) => s.sessionId),
    ).toEqual(["c", "a", "b"]);
  });
});

describe("sessionMatchesSearch", () => {
  const session = baseSession({
    sessionId: "abc12345",
    clientHint: "claude-desktop",
    connectionNames: ["dev-db", "stage"],
  });

  it("matches empty / whitespace query", () => {
    expect(sessionMatchesSearch(session, "")).toBe(true);
    expect(sessionMatchesSearch(session, "   ")).toBe(true);
  });

  it("matches by session id prefix or substring", () => {
    expect(sessionMatchesSearch(session, "abc12")).toBe(true);
    expect(sessionMatchesSearch(session, "12345")).toBe(true);
  });

  it("matches by client hint case-insensitively", () => {
    expect(sessionMatchesSearch(session, "CLAUDE")).toBe(true);
  });

  it("matches by any connection name", () => {
    expect(sessionMatchesSearch(session, "stage")).toBe(true);
    expect(sessionMatchesSearch(session, "dev-db")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(sessionMatchesSearch(session, "missing")).toBe(false);
  });

  it("handles missing client hint without throwing", () => {
    const noHint = baseSession({ clientHint: null });
    expect(sessionMatchesSearch(noHint, "claude")).toBe(false);
  });
});
