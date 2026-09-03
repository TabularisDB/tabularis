import { afterEach, describe, expect, it, vi } from "vitest";
import { getExplainParser, parseRawExplain, unregisterExplainParser } from "@tabularis/explain";

import { loadPluginExplainParsers } from "../../src/utils/pluginExplainLoader";
import type { PluginManifest } from "../../src/types/plugins";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
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

function parserDescriptor(engine: string, format: string): string {
  return `{
    engine: ${JSON.stringify(engine)},
    format: ${JSON.stringify(format)},
    label: "Bundle label",
    parse: function (payload) {
      return {
        root: {
          id: "plugin-root",
          node_type: payload,
          relation: null,
          startup_cost: null,
          total_cost: null,
          plan_rows: null,
          actual_rows: null,
          actual_time_ms: null,
          actual_loops: null,
          buffers_hit: null,
          buffers_read: null,
          filter: null,
          index_condition: null,
          join_type: null,
          hash_condition: null,
          extra: {},
          children: []
        },
        planning_time_ms: null,
        execution_time_ms: null,
        original_query: "bundle query",
        driver: "bundle driver",
        has_analyze_data: false,
        raw_output: payload
      };
    }
  }`;
}

afterEach(() => {
  for (const format of testFormats) unregisterExplainParser(format);
  testFormats.clear();
  invokeMock.mockReset();
  vi.restoreAllMocks();
});

describe("pluginExplainLoader", () => {
  it("registers a bundle parser that parseRawExplain can dispatch to", async () => {
    const pluginManifest = manifest([
      {
        engine: "example-db",
        format: "example-db-plan-text",
        label: "Manifest label",
        module: "explain/dist/index.iife.js",
      },
    ]);
    invokeMock.mockResolvedValue(`
      if (typeof __TABULARIS_EXPLAIN__.registerExplainParser !== "function") {
        throw new Error("host EXPLAIN API missing");
      }
      var __tabularis_explain_parser__ = {
        default: ${parserDescriptor("example-db", "example-db-plan-text")}
      };
    `);

    const formats = await loadPluginExplainParsers(pluginManifest);
    const plan = parseRawExplain({
      engine: "example-db",
      format: "example-db-plan-text",
      payload: "raw plan",
      original_query: "SELECT 1",
    });

    expect(formats).toEqual(["example-db-plan-text"]);
    expect(invokeMock).toHaveBeenCalledWith("read_plugin_file", {
      pluginId: "example-plugin",
      filePath: "explain/dist/index.iife.js",
    });
    expect(getExplainParser("example-db-plan-text")?.label).toBe("Manifest label");
    expect(plan.root.node_type).toBe("raw plan");
    expect(plan.driver).toBe("example-db");
    expect(plan.original_query).toBe("SELECT 1");
  });

  it("reads a shared module once and accepts an exported parser array", async () => {
    const pluginManifest = manifest([
      { engine: "example-db", format: "example-format-a", module: "explain/shared.js" },
      { engine: "example-db", format: "example-format-b", module: "explain/shared.js" },
    ]);
    invokeMock.mockResolvedValue(`
      var __tabularis_explain_parser__ = [
        ${parserDescriptor("example-db", "example-format-a")},
        ${parserDescriptor("example-db", "example-format-b")}
      ];
    `);

    const formats = await loadPluginExplainParsers(pluginManifest);

    expect(formats).toEqual(["example-format-a", "example-format-b"]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("registers interleaved module declarations in manifest order", async () => {
    const pluginManifest = manifest([
      { engine: "example-db", format: "ordered-format-a", module: "explain/shared.js" },
      { engine: "example-db", format: "ordered-format-b", module: "explain/other.js" },
      { engine: "example-db", format: "ordered-format-c", module: "explain/shared.js" },
    ]);
    invokeMock
      .mockResolvedValueOnce(`
        var __tabularis_explain_parser__ = [
          ${parserDescriptor("example-db", "ordered-format-a")},
          ${parserDescriptor("example-db", "ordered-format-c")}
        ];
      `)
      .mockResolvedValueOnce(
        `var __tabularis_explain_parser__ = ${parserDescriptor("example-db", "ordered-format-b")};`,
      );

    const formats = await loadPluginExplainParsers(pluginManifest);

    expect(formats).toEqual(["ordered-format-a", "ordered-format-b", "ordered-format-c"]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("contains a throwing bundle and logs the plugin and module", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pluginManifest = manifest([
      { engine: "example-db", format: "throwing-format", module: "explain/throw.js" },
    ]);
    invokeMock.mockResolvedValue('throw new Error("bundle exploded");');

    const formats = await loadPluginExplainParsers(pluginManifest);

    expect(formats).toEqual([]);
    expect(getExplainParser("throwing-format")).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[PluginExplain] Failed to load module "explain/throw.js" for plugin "example-plugin":',
      expect.any(Error),
    );
  });

  it("skips a bundle with no usable export", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pluginManifest = manifest([
      { engine: "example-db", format: "missing-format", module: "explain/missing.js" },
    ]);
    invokeMock.mockResolvedValue("var unrelated_bundle_export = {};");

    const formats = await loadPluginExplainParsers(pluginManifest);

    expect(formats).toEqual([]);
    expect(getExplainParser("missing-format")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('must export exactly one parser for engine "example-db"'),
    );
  });

  it("skips an invalid parser object", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pluginManifest = manifest([
      { engine: "example-db", format: "invalid-format", module: "explain/invalid.js" },
    ]);
    invokeMock.mockResolvedValue(`
      var __tabularis_explain_parser__ = {
        engine: "example-db",
        format: "invalid-format",
        parse: "not callable"
      };
    `);

    const formats = await loadPluginExplainParsers(pluginManifest);

    expect(formats).toEqual([]);
    expect(getExplainParser("invalid-format")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("exported an invalid parser"),
    );
  });

  it("stops before evaluating a bundle once loading is cancelled", async () => {
    const pluginManifest = manifest([
      { engine: "example-db", format: "cancelled-format", module: "explain/cancelled.js" },
    ]);
    let cancelled = false;
    invokeMock.mockImplementation(async () => {
      // The enabled-plugin set changes while the module read is in flight.
      cancelled = true;
      return `var __tabularis_explain_parser__ = ${parserDescriptor("example-db", "cancelled-format")};`;
    });

    const formats = await loadPluginExplainParsers(pluginManifest, () => !cancelled);

    expect(formats).toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(getExplainParser("cancelled-format")).toBeNull();
  });

  it("registers nothing when cancelled before the first module read", async () => {
    const pluginManifest = manifest([
      { engine: "example-db", format: "never-read", module: "explain/never.js" },
    ]);
    invokeMock.mockResolvedValue("throw new Error('must not be evaluated');");

    const formats = await loadPluginExplainParsers(pluginManifest, () => false);

    expect(formats).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(getExplainParser("never-read")).toBeNull();
  });

  it("can load again after the previous pass unregisters its formats", async () => {
    const pluginManifest = manifest([
      { engine: "example-db", format: "repeat-format", module: "explain/repeat.js" },
    ]);
    invokeMock.mockResolvedValue(
      `var __tabularis_explain_parser__ = ${parserDescriptor("example-db", "repeat-format")};`,
    );

    const firstPass = await loadPluginExplainParsers(pluginManifest);
    firstPass.forEach(unregisterExplainParser);
    const secondPass = await loadPluginExplainParsers(pluginManifest);

    expect(firstPass).toEqual(["repeat-format"]);
    expect(secondPass).toEqual(["repeat-format"]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(
      parseRawExplain({
        engine: "example-db",
        format: "repeat-format",
        payload: "second pass",
        original_query: "SELECT 2",
      }).root.node_type,
    ).toBe("second pass");
  });
});
