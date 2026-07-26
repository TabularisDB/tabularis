/**
 * Postgres `EXPLAIN` parsers: `FORMAT JSON` documents and the default
 * indentation-based text output.
 *
 * Pure string -> `ExplainPlan` transformations: no connection, no statement
 * execution, no file system.
 */

import type { ExplainNode, ExplainPlan } from "../types";
import {
  NodeIdAllocator,
  asArray,
  asLoopCount,
  asNumber,
  asObject,
  asString,
  createExplainNode,
  type JsonObject,
} from "./node";

/**
 * Parse a Postgres `EXPLAIN (FORMAT JSON)` document into an `ExplainPlan`.
 *
 * Postgres emits a top-level JSON array with one element per explained
 * statement. We honour this by picking the first element; each object carries
 * a `Plan` node plus optional `Planning Time` / `Execution Time` timings.
 */
export function parsePostgresJson(raw: string): ExplainPlan {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse EXPLAIN JSON: ${String(err)}`);
  }

  const top = firstStatement(value);
  const planObj = top["Plan"];
  if (planObj === undefined) {
    throw new Error("EXPLAIN JSON missing 'Plan' key");
  }

  const ids = new NodeIdAllocator();
  const root = parsePgPlanNode(planObj, ids);

  const planningTime = asNumber(top["Planning Time"]);
  const executionTime = asNumber(top["Execution Time"]);
  const hasAnalyzeData = root.actual_rows !== null || root.actual_time_ms !== null;

  return {
    root,
    planning_time_ms: planningTime,
    execution_time_ms: executionTime,
    original_query: "",
    driver: "postgres",
    has_analyze_data: hasAnalyzeData,
    raw_output: raw,
  };
}

function firstStatement(value: unknown): JsonObject {
  if (Array.isArray(value)) {
    const first = asObject(value[0]);
    if (first === null) {
      throw new Error("EXPLAIN JSON array is empty");
    }
    return first;
  }
  const obj = asObject(value);
  if (obj !== null) {
    return obj;
  }
  throw new Error("EXPLAIN JSON must be an array or object");
}

const PG_KNOWN_KEYS: readonly string[] = [
  "Node Type",
  "Relation Name",
  "Startup Cost",
  "Total Cost",
  "Plan Rows",
  "Actual Rows",
  "Actual Total Time",
  "Actual Loops",
  "Shared Hit Blocks",
  "Shared Read Blocks",
  "Filter",
  "Index Cond",
  "Join Type",
  "Hash Cond",
  "Plans",
];

function parsePgPlanNode(node: unknown, ids: NodeIdAllocator): ExplainNode {
  const id = ids.next();
  const obj = asObject(node) ?? {};

  const extra: JsonObject = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!PG_KNOWN_KEYS.includes(key)) {
      extra[key] = value;
    }
  }

  const children = (asArray(obj["Plans"]) ?? []).map((child) =>
    parsePgPlanNode(child, ids),
  );

  return createExplainNode(id, {
    node_type: asString(obj["Node Type"]) ?? "Unknown",
    relation: asString(obj["Relation Name"]),
    startup_cost: asNumber(obj["Startup Cost"]),
    total_cost: asNumber(obj["Total Cost"]),
    plan_rows: asNumber(obj["Plan Rows"]),
    actual_rows: asNumber(obj["Actual Rows"]),
    actual_time_ms: asNumber(obj["Actual Total Time"]),
    actual_loops: asLoopCount(obj["Actual Loops"]),
    buffers_hit: asLoopCount(obj["Shared Hit Blocks"]),
    buffers_read: asLoopCount(obj["Shared Read Blocks"]),
    filter: asString(obj["Filter"]),
    index_condition: asString(obj["Index Cond"]),
    join_type: asString(obj["Join Type"]),
    hash_condition: asString(obj["Hash Cond"]),
    extra,
    children,
  });
}

// ---------------------------------------------------------------------------
// Postgres text EXPLAIN parser
// ---------------------------------------------------------------------------
//
// Accepts output such as:
//
//     QUERY PLAN
//     --------------------------------------------------------
//      Hash Join  (cost=1.00..10.00 rows=5 width=40) (actual time=0.10..0.20 rows=5 loops=1)
//        Hash Cond: (a.id = b.id)
//        ->  Seq Scan on a  (cost=0.00..5.00 rows=100 width=4)
//        ->  Hash  (cost=0.50..0.50 rows=1 width=36)
//              ->  Seq Scan on b  (cost=0.00..0.50 rows=1 width=36)
//      Planning Time: 0.123 ms
//      Execution Time: 0.456 ms
//     (6 rows)

/** Parse a Postgres text EXPLAIN dump into an `ExplainPlan`. */
export function parsePostgresText(raw: string): ExplainPlan {
  let planningTime: number | null = null;
  let executionTime: number | null = null;
  let hasAnalyzeData = false;
  const ids = new NodeIdAllocator();

  const stack: Array<{ indent: number; node: ExplainNode }> = [];
  let root: ExplainNode | null = null;

  const promoteOrAttach = (node: ExplainNode): void => {
    const parent = stack[stack.length - 1];
    if (parent !== undefined) {
      parent.node.children.push(node);
    } else if (root === null) {
      root = node;
    } else {
      // Two independent roots in the same document (unusual): nest the
      // extras under the first so we don't silently lose data.
      root.children.push(node);
    }
  };

  const popUntilShallower = (cutoff: number): void => {
    while (stack.length > 0 && stack[stack.length - 1].indent >= cutoff) {
      const frame = stack.pop();
      if (frame !== undefined) {
        promoteOrAttach(frame.node);
      }
    }
  };

  for (const line of raw.split("\n")) {
    const rawLine = line.replace(/\s+$/, "");
    if (rawLine.trim() === "") continue;
    if (isTextMetadataLine(rawLine)) continue;

    const indent = leadingWidth(rawLine);
    const trimmed = rawLine.trimStart();

    const planning = stripMsSuffix(trimmed, "Planning Time:");
    if (planning !== null) {
      planningTime = planning;
      continue;
    }
    const execution = stripMsSuffix(trimmed, "Execution Time:");
    if (execution !== null) {
      executionTime = execution;
      continue;
    }

    const node = parseTextNodeHeader(trimmed, ids);
    if (node !== null) {
      if (node.actual_rows !== null || node.actual_time_ms !== null) {
        hasAnalyzeData = true;
      }
      popUntilShallower(indent);
      stack.push({ indent, node });
    } else {
      const top = stack[stack.length - 1];
      if (top !== undefined) {
        applyTextAttribute(top.node, trimmed);
      }
    }
  }

  // Drain remaining frames into their parents (or promote to root).
  popUntilShallower(0);

  if (root === null) {
    throw new Error("No plan nodes found in EXPLAIN text output");
  }

  return {
    root,
    planning_time_ms: planningTime,
    execution_time_ms: executionTime,
    original_query: "",
    driver: "postgres",
    has_analyze_data: hasAnalyzeData,
    raw_output: raw,
  };
}

function isTextMetadataLine(line: string): boolean {
  const t = line.trim();
  if (t.toUpperCase() === "QUERY PLAN") return true;
  if (t !== "" && [...t].every((c) => c === "-")) return true;
  // Footer like "(6 rows)" / "(1 row)"
  if (t.startsWith("(") && (t.endsWith("rows)") || t.endsWith("row)"))) return true;
  return false;
}

function leadingWidth(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (/\s/.test(ch)) count += 1;
    else break;
  }
  return count;
}

function stripMsSuffix(line: string, prefix: string): number | null {
  if (!line.startsWith(prefix)) return null;
  let rest = line.slice(prefix.length).trim();
  if (rest.endsWith("ms")) rest = rest.slice(0, -2).trim();
  const value = Number(rest);
  return rest !== "" && Number.isFinite(value) ? value : null;
}

/**
 * Parse a single node header line (with the optional leading `->` stripped).
 *
 * Returns `null` when the line lacks the Postgres cost signature, signalling
 * that the caller should treat it as an attribute of the enclosing node.
 */
function parseTextNodeHeader(content: string, ids: NodeIdAllocator): ExplainNode | null {
  // Strip the optional "->" arrow marking a child node.
  const body = content.startsWith("->") ? content.slice(2).trimStart() : content;

  const costPos = body.indexOf("(cost=");
  if (costPos === -1) return null;
  const header = body.slice(0, costPos).trim();
  const tail = body.slice(costPos);

  const costGroup = extractParens(tail);
  if (costGroup === null) return null;
  const [startupCost, totalCost, planRows] = parseCostFields(costGroup.inner);

  // The actual-time block (present only with ANALYZE) immediately follows.
  const actualSection = costGroup.rest.trimStart();
  const actualGroup = extractParens(actualSection);
  const [actualTimeMs, actualRows, actualLoops] =
    actualGroup !== null ? parseActualFields(actualGroup.inner) : [null, null, null];

  const [nodeType, relation] = splitNodeTypeAndRelation(header);

  return createExplainNode(ids.next(), {
    node_type: nodeType,
    relation,
    startup_cost: startupCost,
    total_cost: totalCost,
    plan_rows: planRows,
    actual_rows: actualRows,
    actual_time_ms: actualTimeMs,
    actual_loops: actualLoops,
  });
}

/**
 * Split on the last " on " so we keep modifiers like
 * "Index Scan using users_pkey" in the node type.
 */
function splitNodeTypeAndRelation(header: string): [string, string | null] {
  const idx = header.lastIndexOf(" on ");
  if (idx === -1) return [header.trim(), null];
  const nodeType = header.slice(0, idx).trim();
  const relation = header.slice(idx + 4).trim();
  return relation === "" ? [nodeType, null] : [nodeType, relation];
}

/**
 * Extract the content of the first parenthesised group from `input`, plus the
 * remainder after the closing `)`. Input must start with `(`.
 */
function extractParens(input: string): { inner: string; rest: string } | null {
  if (!input.startsWith("(")) return null;
  let depth = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return { inner: input.slice(1, i), rest: input.slice(i + 1) };
      }
    }
  }
  return null;
}

function parseCostFields(inner: string): [number | null, number | null, number | null] {
  let startup: number | null = null;
  let total: number | null = null;
  let rows: number | null = null;

  if (inner.startsWith("cost=")) {
    const parts = inner.slice(5).split(/\s+/);
    const costExpr = parts[0];
    if (costExpr !== undefined) {
      const sep = costExpr.indexOf("..");
      if (sep !== -1) {
        startup = parseFiniteNumber(costExpr.slice(0, sep));
        total = parseFiniteNumber(costExpr.slice(sep + 2));
      }
    }
    for (const part of parts.slice(1)) {
      if (part.startsWith("rows=")) {
        rows = parseFiniteNumber(part.slice(5));
      }
    }
  }
  return [startup, total, rows];
}

function parseActualFields(inner: string): [number | null, number | null, number | null] {
  // Three shapes:
  //   "actual time=0.10..0.20 rows=5 loops=1"
  //   "actual rows=5 loops=1"  (for cheap nodes under BUFFERS-only)
  //   "never executed"
  const trimmed = inner.trim();
  if (trimmed.toLowerCase() === "never executed") {
    return [null, null, null];
  }
  const rest = trimmed.startsWith("actual ") ? trimmed.slice(7) : trimmed;

  let totalTime: number | null = null;
  let rows: number | null = null;
  let loops: number | null = null;

  for (const part of rest.split(/\s+/)) {
    if (part.startsWith("time=")) {
      const expr = part.slice(5);
      const sep = expr.indexOf("..");
      if (sep !== -1) {
        totalTime = parseFiniteNumber(expr.slice(sep + 2));
      }
    } else if (part.startsWith("rows=")) {
      rows = parseFiniteNumber(part.slice(5));
    } else if (part.startsWith("loops=")) {
      loops = parseFiniteNumber(part.slice(6));
    }
  }
  return [totalTime, rows, loops];
}

function parseFiniteNumber(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function applyTextAttribute(node: ExplainNode, content: string): void {
  if (content.startsWith("Filter:")) {
    node.filter = content.slice("Filter:".length).trim();
  } else if (content.startsWith("Index Cond:")) {
    node.index_condition = content.slice("Index Cond:".length).trim();
  } else if (content.startsWith("Hash Cond:")) {
    node.hash_condition = content.slice("Hash Cond:".length).trim();
  } else if (content.startsWith("Join Type:")) {
    node.join_type = content.slice("Join Type:".length).trim();
  } else {
    const sep = content.indexOf(":");
    if (sep !== -1) {
      node.extra[content.slice(0, sep).trim()] = content.slice(sep + 1).trim();
    }
  }
}
