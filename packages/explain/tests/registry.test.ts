import { afterEach, describe, expect, it, vi } from "vitest";
import type { RawExplainOutput } from "../src/raw";
import { parseRawExplain } from "../src/raw";
import {
  getExplainParser,
  listExplainParsers,
  registerExplainParser,
  type RegisteredExplainParser,
  unregisterExplainParser,
} from "../src/registry";
import {
  detectFormat,
  detectFormatFor,
  explainEngineFromDriverName,
  parseExplainFor,
} from "../src/parsers/source";
import type { ExplainPlan } from "../src/types";

const CUSTOM_FORMATS = [
  "acme-plan",
  "first-plan",
  "second-plan",
  "throwing-plan",
  "unknown-plan",
  "postgres-json",
] as const;

function plan(nodeType: string): ExplainPlan {
  return {
    root: {
      id: "custom-0",
      node_type: nodeType,
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
      children: [],
    },
    planning_time_ms: null,
    execution_time_ms: null,
    original_query: "",
    driver: "acme",
    has_analyze_data: false,
    raw_output: null,
  };
}

function raw(format: string, engine = "acme"): RawExplainOutput {
  return {
    engine,
    format,
    payload: "ACME PLAN",
    original_query: "SELECT 1",
  };
}

afterEach(() => {
  for (const format of CUSTOM_FORMATS) unregisterExplainParser(format);
  vi.restoreAllMocks();
});

describe("EXPLAIN parser registry", () => {
  it("keeps built-in behavior unchanged with no mutable parsers", () => {
    expect(listExplainParsers().map(({ format }) => format)).toEqual([
      "postgres-json",
      "postgres-text",
      "mysql-json",
      "mysql-text",
      "mysql-analyze-text",
      "mysql-tabular-rows",
      "sqlite-eqp-rows",
    ]);
    expect(Object.isFrozen(listExplainParsers())).toBe(true);

    const postgres = parseRawExplain({
      engine: "postgres",
      format: "postgres-json",
      payload: '[{ "Plan": { "Node Type": "Result" } }]',
      original_query: "SELECT 1",
    });
    expect(postgres.root.node_type).toBe("Result");
    expect(detectFormat("Seq Scan on users (cost=0.00..1.00 rows=1 width=4)")).toBe(
      "postgres-text",
    );
  });

  it("registers and dispatches a custom parser for raw and source payloads", () => {
    registerExplainParser({
      engine: "acme",
      format: "acme-plan",
      label: "Acme plan",
      parse: () => plan("Acme Scan"),
      sniff: (payload) => payload.startsWith("ACME"),
    });

    expect(getExplainParser("acme-plan")?.label).toBe("Acme plan");
    expect(detectFormatFor("ACME PLAN", "ACME")).toBe("acme-plan");
    expect(detectFormat("ACME PLAN")).toBe("acme-plan");
    expect(parseExplainFor("ACME PLAN", "acme").root.node_type).toBe(
      "Acme Scan",
    );
    expect(explainEngineFromDriverName(" AcMe ")).toBe("acme");

    const parsed = parseRawExplain(raw("acme-plan"));
    expect(parsed.root.node_type).toBe("Acme Scan");
    expect(parsed.driver).toBe("acme");
    expect(parsed.original_query).toBe("SELECT 1");
  });

  it("replaces a registration in place and warns exactly once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = {
      engine: "acme",
      format: "acme-plan",
      parse: () => plan("First"),
    };
    const replacement = {
      ...first,
      parse: () => plan("Replacement"),
    };

    registerExplainParser(first);
    const position = listExplainParsers().findIndex(
      ({ format }) => format === "acme-plan",
    );
    registerExplainParser(replacement);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "EXPLAIN parser format 'acme-plan' is already registered; replacing it.",
    );
    expect(getExplainParser("acme-plan")).toBe(replacement);
    expect(
      listExplainParsers().findIndex(({ format }) => format === "acme-plan"),
    ).toBe(position);
    expect(parseRawExplain(raw("acme-plan")).root.node_type).toBe("Replacement");
  });

  it("removes custom parsers and reveals overridden built-ins", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const builtin = getExplainParser("postgres-json");

    registerExplainParser({
      engine: "postgres",
      format: "postgres-json",
      parse: () => plan("Override"),
    });
    registerExplainParser({
      engine: "acme",
      format: "acme-plan",
      parse: () => plan("Custom"),
    });

    unregisterExplainParser("postgres-json");
    unregisterExplainParser("acme-plan");
    unregisterExplainParser("missing-format");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(getExplainParser("postgres-json")).toBe(builtin);
    expect(getExplainParser("acme-plan")).toBeNull();
  });

  it("throws the exact owner-directed error for an unknown raw format", () => {
    expect(() => parseRawExplain(raw("unknown-plan"))).toThrow(
      "No EXPLAIN parser registered for format 'unknown-plan' (engine 'acme'). " +
        "Import the parser package for 'acme' before parsing.",
    );
  });

  it("keeps built-in sniffing ahead of custom sniffers", () => {
    const sniff = vi.fn(() => true);
    registerExplainParser({
      engine: "acme",
      format: "acme-plan",
      parse: () => plan("Custom"),
      sniff,
    });

    expect(detectFormat('[{ "Plan": { "Node Type": "Result" } }]')).toBe(
      "postgres-json",
    );
    expect(sniff).not.toHaveBeenCalled();
  });

  it("tries custom sniffers in registration order and ignores failures", () => {
    registerExplainParser({
      engine: "acme",
      format: "throwing-plan",
      parse: () => plan("Throwing"),
      sniff: () => {
        throw new Error("broken sniffer");
      },
    });
    registerExplainParser({
      engine: "acme",
      format: "first-plan",
      parse: () => plan("First"),
      sniff: () => true,
    });
    registerExplainParser({
      engine: "acme",
      format: "second-plan",
      parse: () => plan("Second"),
      sniff: () => true,
    });

    expect(detectFormat("CUSTOM PLAN")).toBe("first-plan");
    expect(detectFormatFor("CUSTOM PLAN", "acme")).toBe("first-plan");
  });

  it("validates registrations before mutating the registry", () => {
    const invalid = [
      { engine: "", format: "acme-plan", parse: () => plan("Invalid") },
      { engine: "acme", format: " ", parse: () => plan("Invalid") },
      { engine: "acme", format: "acme-plan", parse: null },
    ];

    for (const parser of invalid) {
      expect(() =>
        registerExplainParser(parser as unknown as RegisteredExplainParser),
      ).toThrow(TypeError);
    }
    expect(getExplainParser("acme-plan")).toBeNull();
  });

  it("propagates parser exceptions unchanged", () => {
    const error = new Error("custom parser failed");
    registerExplainParser({
      engine: "acme",
      format: "acme-plan",
      parse: () => {
        throw error;
      },
    });

    expect(() => parseRawExplain(raw("acme-plan"))).toThrow(error);
  });
});
