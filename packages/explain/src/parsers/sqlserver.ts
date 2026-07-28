import { XMLParser } from "fast-xml-parser";

import type { ExplainNode, ExplainPlan } from "../types";

type XmlObject = Record<string, unknown>;

function object(value: unknown): XmlObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as XmlObject)
    : null;
}

function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstDescendant(root: unknown, key: string): XmlObject | null {
  if (Array.isArray(root)) {
    for (const item of root) {
      const match = firstDescendant(item, key);
      if (match !== null) return match;
    }
    return null;
  }
  const node = object(root);
  if (node === null) return null;
  for (const [name, value] of Object.entries(node)) {
    if (name === key) {
      const candidate = object(array(value)[0]);
      if (candidate !== null) return candidate;
    }
    const nested = firstDescendant(value, key);
    if (nested !== null) return nested;
  }
  return null;
}

function childOperators(operator: XmlObject): XmlObject[] {
  const children: XmlObject[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = object(value);
    if (node === null) return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "RelOp") {
        for (const item of array(child)) {
          const relOp = object(item);
          if (relOp !== null) children.push(relOp);
        }
      } else {
        visit(child);
      }
    }
  };
  for (const [key, value] of Object.entries(operator)) {
    if (!key.startsWith("@_")) visit(value);
  }
  return children;
}

function firstOwnedDescendant(root: unknown, key: string): XmlObject | null {
  if (Array.isArray(root)) {
    for (const item of root) {
      const match = firstOwnedDescendant(item, key);
      if (match !== null) return match;
    }
    return null;
  }
  const node = object(root);
  if (node === null) return null;
  for (const [name, value] of Object.entries(node)) {
    if (name === "RelOp") continue;
    if (name === key) {
      const candidate = object(array(value)[0]);
      if (candidate !== null) return candidate;
    }
    const nested = firstOwnedDescendant(value, key);
    if (nested !== null) return nested;
  }
  return null;
}

function relationName(operator: XmlObject): string | null {
  const target = firstOwnedDescendant(operator, "Object");
  if (target === null) return null;
  const table = target["@_Table"];
  return typeof table === "string" ? table.replaceAll("[", "").replaceAll("]", "") : null;
}

function predicate(operator: XmlObject): string | null {
  const scalar = firstOwnedDescendant(operator, "ScalarOperator");
  return typeof scalar?.["@_ScalarString"] === "string"
    ? scalar["@_ScalarString"]
    : null;
}

function runtimeMetrics(operator: XmlObject): {
  rows: number | null;
  time: number | null;
  loops: number | null;
} {
  const runtime = firstOwnedDescendant(operator, "RunTimeInformation");
  if (runtime === null) return { rows: null, time: null, loops: null };
  const counters = array(runtime.RunTimeCountersPerThread)
    .map(object)
    .filter((value): value is XmlObject => value !== null);
  if (counters.length === 0) return { rows: null, time: null, loops: null };
  return {
    rows: counters.reduce((sum, item) => sum + (number(item["@_ActualRows"]) ?? 0), 0),
    time: Math.max(...counters.map((item) => number(item["@_ActualElapsedms"]) ?? 0)),
    loops: counters.reduce((sum, item) => sum + (number(item["@_ActualExecutions"]) ?? 0), 0),
  };
}

function parseOperator(operator: XmlObject, fallbackId: number): ExplainNode {
  const physical = String(operator["@_PhysicalOp"] ?? operator["@_LogicalOp"] ?? "Unknown");
  const logical = String(operator["@_LogicalOp"] ?? physical);
  const runtime = runtimeMetrics(operator);
  return {
    id: `sqlserver-${String(operator["@_NodeId"] ?? fallbackId)}`,
    node_type: physical,
    relation: relationName(operator),
    startup_cost: null,
    total_cost: number(operator["@_EstimatedTotalSubtreeCost"]),
    plan_rows: number(operator["@_EstimateRows"]),
    actual_rows: runtime.rows,
    actual_time_ms: runtime.time,
    actual_loops: runtime.loops,
    buffers_hit: null,
    buffers_read: null,
    filter: predicate(operator),
    index_condition: null,
    join_type: logical.toLowerCase().includes("join") ? logical : null,
    hash_condition: null,
    extra: { logical_operation: logical },
    children: childOperators(operator).map((child, index) => parseOperator(child, fallbackId * 10 + index + 1)),
  };
}

/** Parse SQL Server SHOWPLAN_XML into the shared visual-plan model. */
export function parseSqlServerShowplanXml(raw: string): ExplainPlan {
  let document: unknown;
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: true,
      removeNSPrefix: true,
    }).parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse SQL Server SHOWPLAN_XML: ${String(error)}`);
  }
  const operator = firstDescendant(document, "RelOp");
  if (operator === null) {
    throw new Error("SQL Server SHOWPLAN_XML does not contain a RelOp");
  }
  const root = parseOperator(operator, 0);
  return {
    root,
    planning_time_ms: null,
    execution_time_ms: root.actual_time_ms,
    original_query: "",
    driver: "sqlserver",
    has_analyze_data: root.actual_rows !== null,
    raw_output: raw,
  };
}
