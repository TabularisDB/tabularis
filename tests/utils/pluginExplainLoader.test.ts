import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getExplainParser, parseRawExplain } from "@tabularis/explain";

import { disposePluginExplainParsers, loadPluginExplainParsers } from "../../src/utils/pluginExplainLoader";
import type { PluginManifest } from "../../src/types/plugins";

const guestModules = vi.hoisted(() => new Map<string, unknown[] | Error>());
const rpcCallMock = vi.hoisted(() => vi.fn());
const rpcCloseMock = vi.hoisted(() => vi.fn());
const connectFrameMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/plugins/sandbox/connectFrame", () => ({
  pluginFrameUrl: vi.fn((pluginId: string, modulePath: string, mode: string) =>
    `tabularis-plugin://localhost/${pluginId}/__guest__.html?module=${modulePath}&mode=${mode}`),
  connectFrame: connectFrameMock,
}));

const testFormats = new Set<string>();

function manifest(
  explainParsers: NonNullable<PluginManifest["explain_parsers"]>,
): PluginManifest {
  for (const entry of explainParsers) testFormats.add(entry.format);
  return {
    id: "example-plugin",
    name: "Example Plugin",
    version: "1.0.0",
    description: "Test plugin",
    default_port: null,
    capabilities: {
      schemas: false,
      views: false,
      routines: false,
      file_based: false,
      folder_based: false,
      identifier_quote: '"',
      alter_primary_key: false,
    },
    explain_parsers: explainParsers,
  };
}

function descriptor(engine: string, format: string, hasSniff = false) {
  return { engine, format, label: "Bundle label", hasSniff };
}

function configureModule(modulePath: string, parsers: unknown[] | Error) {
  guestModules.set(modulePath, parsers);
}

beforeEach(() => {
  guestModules.clear();
  rpcCallMock.mockReset();
  rpcCloseMock.mockReset();
  connectFrameMock.mockReset();
  connectFrameMock.mockImplementation(async () => ({
    call: rpcCallMock,
    close: rpcCloseMock,
  }));
  rpcCallMock.mockImplementation(async (method: string, args: unknown[] = []) => {
    if (method === "explain.load") {
      const result = guestModules.get(String(args[0]));
      if (result instanceof Error) throw result;
      return result ?? [];
    }
    if (method === "explain.parse") {
      return {
        root: { id: "plugin-root", node_type: args[1], children: [] },
        planning_time_ms: null,
        execution_time_ms: null,
        original_query: "bundle query",
        driver: "bundle driver",
        has_analyze_data: false,
        raw_output: args[1],
      };
    }
    if (method === "explain.sniff") return String(args[1]).startsWith("EXAMPLE");
    throw new Error(`unexpected method: ${method}`);
  });
});

afterEach(() => {
  disposePluginExplainParsers(testFormats);
  testFormats.clear();
  vi.restoreAllMocks();
});

describe("pluginExplainLoader", () => {
  it("registers an asynchronous parser proxy without evaluating code in the host", async () => {
    configureModule("explain/dist/index.iife.js", [descriptor("example-db", "example-db-plan-text")]);
    const pluginManifest = manifest([
      {
        engine: "example-db",
        format: "example-db-plan-text",
        label: "Manifest label",
        module: "explain/dist/index.iife.js",
      },
    ]);

    const formats = await loadPluginExplainParsers(pluginManifest);
    const plan = await parseRawExplain({
      engine: "example-db",
      format: "example-db-plan-text",
      payload: "raw plan",
      original_query: "SELECT 1",
    });

    expect(formats).toEqual(["example-db-plan-text"]);
    expect(getExplainParser("example-db-plan-text")?.label).toBe("Manifest label");
    expect(plan.root.node_type).toBe("raw plan");
    expect(rpcCallMock).toHaveBeenCalledWith("explain.parse", ["example-db-plan-text", "raw plan"]);
    disposePluginExplainParsers(formats);
    expect(rpcCloseMock).toHaveBeenCalledTimes(1);
  });

  it("loads a shared module once and supports async sniffing", async () => {
    configureModule("explain/shared.js", [
      descriptor("example-db", "example-format-a", true),
      descriptor("example-db", "example-format-b"),
    ]);
    const formats = await loadPluginExplainParsers(manifest([
      { engine: "example-db", format: "example-format-a", module: "explain/shared.js" },
      { engine: "example-db", format: "example-format-b", module: "explain/shared.js" },
    ]));

    expect(formats).toEqual(["example-format-a", "example-format-b"]);
    expect(rpcCallMock.mock.calls.filter(([method]) => method === "explain.load")).toHaveLength(1);
    expect(await getExplainParser("example-format-a")?.sniff?.("EXAMPLE PLAN")).toBe(true);
    disposePluginExplainParsers(formats);
    expect(rpcCloseMock).toHaveBeenCalledTimes(1);
  });

  it("registers interleaved module declarations in manifest order", async () => {
    configureModule("explain/shared.js", [
      descriptor("example-db", "ordered-format-a"),
      descriptor("example-db", "ordered-format-c"),
    ]);
    configureModule("explain/other.js", [descriptor("example-db", "ordered-format-b")]);
    const formats = await loadPluginExplainParsers(manifest([
      { engine: "example-db", format: "ordered-format-a", module: "explain/shared.js" },
      { engine: "example-db", format: "ordered-format-b", module: "explain/other.js" },
      { engine: "example-db", format: "ordered-format-c", module: "explain/shared.js" },
    ]));

    expect(formats).toEqual(["ordered-format-a", "ordered-format-b", "ordered-format-c"]);
    expect(rpcCallMock.mock.calls.filter(([method]) => method === "explain.load")).toHaveLength(2);
    disposePluginExplainParsers(formats);
  });

  it("contains a failing guest module and logs its plugin and module", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    configureModule("explain/throw.js", new Error("bundle exploded"));
    const formats = await loadPluginExplainParsers(manifest([
      { engine: "example-db", format: "throwing-format", module: "explain/throw.js" },
    ]));

    expect(formats).toEqual([]);
    expect(getExplainParser("throwing-format")).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[PluginExplain] Failed to load module "explain/throw.js" for plugin "example-plugin":',
      expect.any(Error),
    );
  });

  it("skips undeclared or mismatched parser exports", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    configureModule("explain/missing.js", []);
    const formats = await loadPluginExplainParsers(manifest([
      { engine: "example-db", format: "missing-format", module: "explain/missing.js" },
    ]));

    expect(formats).toEqual([]);
    expect(getExplainParser("missing-format")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('must export exactly one parser for engine "example-db"'),
    );
    expect(rpcCloseMock).toHaveBeenCalledTimes(1);
  });

  it("does not create a frame when loading is already cancelled", async () => {
    const formats = await loadPluginExplainParsers(manifest([
      { engine: "example-db", format: "cancelled-format", module: "explain/cancelled.js" },
    ]), () => false);

    expect(formats).toEqual([]);
    expect(connectFrameMock).not.toHaveBeenCalled();
    expect(getExplainParser("cancelled-format")).toBeNull();
  });

  it("closes an opened guest frame when loading is cancelled during the handshake", async () => {
    configureModule("explain/cancelled.js", [descriptor("example-db", "cancelled-format")]);
    let cancelled = false;
    connectFrameMock.mockImplementation(async () => {
      cancelled = true;
      return { call: rpcCallMock, close: rpcCloseMock };
    });
    const formats = await loadPluginExplainParsers(manifest([
      { engine: "example-db", format: "cancelled-format", module: "explain/cancelled.js" },
    ]), () => !cancelled);

    expect(formats).toEqual([]);
    expect(getExplainParser("cancelled-format")).toBeNull();
    expect(rpcCloseMock).toHaveBeenCalledTimes(1);
  });
});
