import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { i18n } from "../../src/i18n/lingui";
import { refreshFromCdn } from "../../src/i18n/ota";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";

const po = (lines: string[]) => lines.join("\n");

const id = (msg: string, ctx = "") => generateMessageId(msg, ctx);

// Lingui's load() merges, so each test uses a fresh locale to stay isolated.
let LOC = "";
let n = 0;

describe("refreshFromCdn", () => {
  beforeEach(() => {
    LOC = `test-${n++}`;
    i18n.load(LOC, {});
    i18n.activate(LOC);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("overlays non-plural CDN translations; skips plural + untranslated", async () => {
    const body = po([
      'msgid ""',
      'msgstr "Content-Type: text/plain; charset=UTF-8\\n"',
      "",
      'msgid "Close"',
      'msgstr "Schließen"',
      "",
      'msgctxt "connections.export"',
      'msgid "Export Connections"',
      'msgstr "Verbindungen exportieren"',
      "",
      'msgid "Untranslated"',
      'msgstr ""',
      "",
      'msgid "{n, plural, one {# row} other {# rows}}"',
      'msgid_plural "{n, plural, one {# row} other {# rows}}"',
      'msgstr[0] "# Zeile"',
      'msgstr[1] "# Zeilen"',
      "",
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(body) }));

    await refreshFromCdn(LOC);

    // plain + context entries overlaid
    expect(i18n._(id("Close"))).toBe("Schließen");
    expect(i18n._(id("Export Connections", "connections.export"))).toBe("Verbindungen exportieren");
    // same English, different context must NOT be overwritten by the export one
    expect(i18n._(id("Export Connections", "connections.exportTitle"))).toBe(
      id("Export Connections", "connections.exportTitle"),
    );
    // untranslated -> not loaded (falls back to id here, bundled value in the app)
    expect(i18n._(id("Untranslated"))).toBe(id("Untranslated"));
    // plural -> skipped, served by the bundled catalog
    const pluralId = id("{n, plural, one {# row} other {# rows}}");
    expect(i18n._(pluralId)).toBe(pluralId);
  });

  it("no-ops when offline (fetch rejects)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(refreshFromCdn(LOC)).resolves.toBeUndefined();
    expect(i18n._(id("Close"))).toBe(id("Close")); // unchanged
  });

  it("no-ops on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await refreshFromCdn(LOC);
    expect(i18n._(id("Close"))).toBe(id("Close"));
  });
});
