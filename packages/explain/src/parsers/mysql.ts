/**
 * MySQL / MariaDB plan parsers.
 *
 * Covers the two shapes these engines emit that carry a full plan tree:
 * `EXPLAIN FORMAT=JSON` (and MariaDB's `ANALYZE FORMAT=JSON`, with its
 * `filesort` / `temporary_table` / `subquery_cache` wrappers), MariaDB's
 * `ANALYZE FORMAT=TEXT` indented output, plus the tabular `EXPLAIN` rows that
 * the host decodes from the wire and hands over as plain values.
 */

import type { ExplainNode, ExplainPlan } from "../types";
import {
  NodeIdAllocator,
  asArray,
  asLoopCount,
  asLooseNumber,
  asNumber,
  asObject,
  asString,
  createExplainNode,
  hasAnalyzeDataRecursive,
  type JsonObject,
} from "./node";

/**
 * Parse a MySQL `EXPLAIN FORMAT=JSON` or MariaDB `ANALYZE FORMAT=JSON`
 * document into a plan.
 *
 * Both shapes hang the tree off a `query_block` key, and MariaDB's analysing
 * variant adds `query_optimization.r_total_time_ms` — picked up as the
 * planning time when present, absent for plain `EXPLAIN FORMAT=JSON`.
 *
 * `original_query` is left empty: only the caller knows the statement.
 */
export function parseMysqlJson(raw: string): ExplainPlan {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse EXPLAIN JSON: ${String(err)}`);
  }

  const doc = asObject(value);
  const queryBlock = doc?.["query_block"];
  if (queryBlock === undefined) {
    throw new Error("EXPLAIN JSON missing 'query_block' key");
  }

  const ids = new NodeIdAllocator();
  const root = parseMysqlQueryBlock(queryBlock, ids);

  const planningTime = asNumber(asObject(doc?.["query_optimization"])?.["r_total_time_ms"]);

  return {
    root,
    planning_time_ms: planningTime,
    execution_time_ms: null,
    original_query: "",
    driver: "mysql",
    has_analyze_data: hasAnalyzeDataRecursive(root),
    raw_output: raw,
  };
}

/**
 * Parse a MySQL `EXPLAIN ANALYZE` / MariaDB `ANALYZE FORMAT=TEXT` indented
 * tree into a plan.
 *
 * `original_query` is left empty: only the caller knows the statement.
 */
export function parseMysqlText(raw: string): ExplainPlan {
  if (raw.trim() === "") {
    throw new Error("EXPLAIN ANALYZE returned no output");
  }

  const ids = new NodeIdAllocator();
  const root = parseMysqlAnalyzeText(raw, ids);

  return {
    root,
    planning_time_ms: null,
    execution_time_ms: null,
    original_query: "",
    driver: "mysql",
    has_analyze_data: hasAnalyzeDataRecursive(root),
    raw_output: raw,
  };
}

/**
 * Parse a MariaDB `filesort` JSON object into an ExplainNode.
 *
 * MariaDB ANALYZE FORMAT=JSON emits `"filesort": { sort_key, r_total_time_ms,
 * temporary_table | nested_loop, … }` as a nested object — unlike MySQL which
 * uses the boolean flag `"using_filesort": true`.
 */
function parseMariadbFilesort(value: unknown, ids: NodeIdAllocator): ExplainNode {
  const id = ids.next();
  const filesort = asObject(value) ?? {};

  const extra: JsonObject = {};
  for (const key of [
    "sort_key",
    "r_sort_mode",
    "r_buffer_size",
    "r_limit",
    "r_used_priority_queue",
  ]) {
    if (filesort[key] !== undefined) {
      extra[key] = filesort[key];
    }
  }

  const children: ExplainNode[] = [];
  if (filesort["temporary_table"] !== undefined) {
    children.push(parseMariadbTemporaryTable(filesort["temporary_table"], ids));
  }
  const nestedLoop = asArray(filesort["nested_loop"]);
  if (nestedLoop !== null) {
    for (const item of nestedLoop) {
      children.push(parseMysqlQueryBlock(item, ids));
    }
  }
  if (filesort["ordering_operation"] !== undefined) {
    children.push(parseMysqlQueryBlock(filesort["ordering_operation"], ids));
  }
  // MariaDB: filesort may contain a direct "table" (no nested_loop wrapper)
  if (
    filesort["table"] !== undefined &&
    filesort["nested_loop"] === undefined &&
    filesort["temporary_table"] === undefined
  ) {
    children.push(parseMysqlQueryBlock(filesort, ids));
  }

  return createExplainNode(id, {
    node_type: "Filesort",
    actual_rows: asNumber(filesort["r_output_rows"]),
    actual_time_ms: asNumber(filesort["r_total_time_ms"]),
    actual_loops: asLoopCount(filesort["r_loops"]),
    extra,
    children,
  });
}

/**
 * Parse a MariaDB `temporary_table` JSON wrapper into an ExplainNode.
 *
 * MariaDB wraps `nested_loop` (and sometimes `filesort`) inside a
 * `"temporary_table": { … }` object when a temp table is materialised.
 */
function parseMariadbTemporaryTable(value: unknown, ids: NodeIdAllocator): ExplainNode {
  const id = ids.next();
  const tmpTbl = asObject(value) ?? {};

  const children: ExplainNode[] = [];
  const nestedLoop = asArray(tmpTbl["nested_loop"]);
  if (nestedLoop !== null) {
    for (const item of nestedLoop) {
      children.push(parseMysqlQueryBlock(item, ids));
    }
  }
  if (tmpTbl["filesort"] !== undefined) {
    children.push(parseMariadbFilesort(tmpTbl["filesort"], ids));
  }

  return createExplainNode(id, { node_type: "Temporary Table", children });
}

/**
 * Parse a MariaDB `subquery_cache` wrapper into an ExplainNode.
 *
 * MariaDB wraps correlated/dependent subqueries in `"subquery_cache": {
 * r_loops, r_hit_ratio, query_block: { … } }` when the optimizer can cache
 * repeated evaluations. The `r_hit_ratio` (0–100) indicates how often the
 * cache was reused.
 */
function parseMariadbSubqueryCache(value: unknown, ids: NodeIdAllocator): ExplainNode {
  const id = ids.next();
  const cache = asObject(value) ?? {};

  const extra: JsonObject = {};
  if (cache["r_hit_ratio"] !== undefined) {
    extra["r_hit_ratio"] = cache["r_hit_ratio"];
  }

  const children: ExplainNode[] = [];
  if (cache["query_block"] !== undefined) {
    children.push(parseMysqlQueryBlock(cache["query_block"], ids));
  }

  return createExplainNode(id, {
    node_type: "Subquery Cache",
    actual_loops: asLoopCount(cache["r_loops"]),
    extra,
    children,
  });
}

/**
 * Generic parser for MariaDB wrapper nodes (materialized, union_result,
 * buffer_result, window_functions_computation, expression_cache,
 * read_sorted_file). These share a common pattern: an object that may contain
 * nested_loop, table, filesort, query_specifications, or other recursive
 * structures.
 */
function parseMariadbWrapper(value: unknown, label: string, ids: NodeIdAllocator): ExplainNode {
  const id = ids.next();
  const obj = asObject(value) ?? {};

  const children: ExplainNode[] = [];

  // The wrapper may directly contain a table
  if (obj["table"] !== undefined) {
    children.push(parseMysqlQueryBlock(obj, ids));
  }
  const nestedLoop = asArray(obj["nested_loop"]);
  if (nestedLoop !== null) {
    for (const item of nestedLoop) {
      children.push(parseMysqlQueryBlock(item, ids));
    }
  }
  if (asObject(obj["filesort"]) !== null) {
    children.push(parseMariadbFilesort(obj["filesort"], ids));
  }
  if (obj["temporary_table"] !== undefined) {
    children.push(parseMariadbTemporaryTable(obj["temporary_table"], ids));
  }
  if (obj["query_block"] !== undefined) {
    children.push(parseMysqlQueryBlock(obj["query_block"], ids));
  }
  const specs = asArray(obj["query_specifications"]);
  if (specs !== null) {
    for (const spec of specs) {
      children.push(parseMysqlQueryBlock(spec, ids));
    }
  }
  if (obj["ordering_operation"] !== undefined) {
    children.push(parseMysqlQueryBlock(obj["ordering_operation"], ids));
  }
  if (obj["grouping_operation"] !== undefined) {
    children.push(parseMysqlQueryBlock(obj["grouping_operation"], ids));
  }
  const subs = asArray(obj["attached_subqueries"]);
  if (subs !== null) {
    for (const sq of subs) {
      children.push(parseMysqlQueryBlock(sq, ids));
    }
  }

  return createExplainNode(id, {
    node_type: label,
    total_cost: asLooseNumber(obj["cost"]),
    actual_rows: asNumber(obj["r_rows"]) ?? asNumber(obj["r_output_rows"]),
    actual_time_ms: asNumber(obj["r_total_time_ms"]),
    actual_loops: asLoopCount(obj["r_loops"]),
    children,
  });
}

const MYSQL_ACCESS_TYPES: Readonly<Record<string, string>> = {
  ALL: "Full Table Scan",
  index: "Index Scan",
  range: "Range Scan",
  ref: "Index Lookup",
  eq_ref: "Unique Index Lookup",
  const: "Const Lookup",
  system: "Const Lookup",
  fulltext: "Fulltext Search",
};

export function parseMysqlQueryBlock(value: unknown, ids: NodeIdAllocator): ExplainNode {
  const id = ids.next();
  const block = asObject(value) ?? {};

  // Determine node type from the query block structure
  let nodeType: string;
  let relation: string | null = null;
  let planRows: number | null = null;
  let startupCost: number | null = null;
  let totalCost: number | null = null;
  let filter: string | null = null;

  const table = asObject(block["table"]);
  if (table !== null) {
    const access = asString(table["access_type"]) ?? "ALL";
    nodeType = MYSQL_ACCESS_TYPES[access] ?? access;
    relation = asString(table["table_name"]);

    // Rows: MySQL 8 uses rows_examined_per_scan, MariaDB uses rows
    planRows = asNumber(table["rows_examined_per_scan"]) ?? asNumber(table["rows"]);

    // Cost: MySQL 8 uses cost_info.prefix_cost / read_cost;
    // MariaDB puts "cost" directly on the table object.
    const costInfo = asObject(table["cost_info"]);
    startupCost = asLooseNumber(costInfo?.["read_cost"]);
    totalCost =
      asLooseNumber(costInfo?.["prefix_cost"]) ?? startupCost ?? asLooseNumber(table["cost"]);

    filter = asString(table["attached_condition"]);
  } else {
    if (asObject(block)?.["using_filesort"] === true) {
      nodeType = "Filesort";
    } else if (block["grouping_operation"] !== undefined) {
      nodeType = "Group";
    } else if (block["duplicates_removal"] !== undefined) {
      nodeType = "Duplicate Removal";
    } else if (block["having_condition"] !== undefined) {
      nodeType = "Having Filter";
    } else if (block["window_functions_computation"] !== undefined) {
      nodeType = "Window Functions";
    } else {
      nodeType = "Query Block";
    }

    // Extract cost from block-level cost_info (MySQL) or direct "cost" (MariaDB)
    const costInfo = asObject(block["cost_info"]);
    totalCost =
      asLooseNumber(
        costInfo?.["query_cost"] ?? costInfo?.["sort_cost"] ?? costInfo?.["prefix_cost"],
      ) ?? asLooseNumber(block["cost"]);

    filter = asString(block["having_condition"]);
  }

  // Collect extra fields from the table object
  const knownKeys: readonly string[] = [
    "access_type",
    "table_name",
    "rows_examined_per_scan",
    "rows",
    "cost_info",
    "attached_condition",
    "key",
    "possible_keys",
    "used_key_parts",
  ];
  const extra: JsonObject = {};
  if (table !== null) {
    for (const [k, v] of Object.entries(table)) {
      if (!knownKeys.includes(k)) {
        extra[k] = v;
      }
    }
    const key = asString(table["key"]);
    if (key !== null) {
      extra["key"] = key;
    }
  }

  // Parse children from nested_loop, ordering_operation, subqueries, etc.
  const children: ExplainNode[] = [];

  const nestedLoop = asArray(block["nested_loop"]);
  if (nestedLoop !== null) {
    for (const rawItem of nestedLoop) {
      const item = asObject(rawItem) ?? {};
      if (item["table"] !== undefined) {
        children.push(parseMysqlQueryBlock(item, ids));
      } else if (item["read_sorted_file"] !== undefined) {
        children.push(parseMariadbWrapper(item["read_sorted_file"], "Read Sorted File", ids));
      } else if (asObject(item["filesort"]) !== null) {
        children.push(parseMariadbFilesort(item["filesort"], ids));
      } else if (item["temporary_table"] !== undefined) {
        children.push(parseMariadbTemporaryTable(item["temporary_table"], ids));
      } else if (item["materialized"] !== undefined) {
        children.push(parseMariadbWrapper(item["materialized"], "Materialized Subquery", ids));
      } else if (item["buffer_result"] !== undefined) {
        children.push(parseMariadbWrapper(item["buffer_result"], "Buffer Result", ids));
      }
    }
  }

  if (block["ordering_operation"] !== undefined) {
    children.push(parseMysqlQueryBlock(block["ordering_operation"], ids));
  }
  if (block["grouping_operation"] !== undefined) {
    children.push(parseMysqlQueryBlock(block["grouping_operation"], ids));
  }
  if (block["duplicates_removal"] !== undefined) {
    children.push(parseMysqlQueryBlock(block["duplicates_removal"], ids));
  }

  for (const listKey of ["optimized_away_subqueries", "attached_subqueries"]) {
    const list = asArray(block[listKey]);
    if (list !== null) {
      for (const sq of list) {
        children.push(parseMysqlQueryBlock(sq, ids));
      }
    }
  }

  // MariaDB: "subqueries" array — each entry may be a subquery_cache wrapper
  // or a direct query_block.
  const subqueries = asArray(block["subqueries"]);
  if (subqueries !== null) {
    for (const rawSq of subqueries) {
      const sq = asObject(rawSq) ?? {};
      if (sq["subquery_cache"] !== undefined) {
        children.push(parseMariadbSubqueryCache(sq["subquery_cache"], ids));
      } else if (sq["query_block"] !== undefined || sq["table"] !== undefined) {
        children.push(parseMysqlQueryBlock(sq, ids));
      }
    }
  }

  // MariaDB: filesort as nested object (not the boolean using_filesort flag)
  if (asObject(block["filesort"]) !== null) {
    children.push(parseMariadbFilesort(block["filesort"], ids));
  }
  // MariaDB: temporary_table wrapper around nested_loop
  if (block["temporary_table"] !== undefined) {
    children.push(parseMariadbTemporaryTable(block["temporary_table"], ids));
  }
  // MariaDB: materialized subquery (e.g. IN (SELECT …) materialised as temp table)
  if (block["materialized"] !== undefined) {
    children.push(parseMariadbWrapper(block["materialized"], "Materialized Subquery", ids));
  }
  // MariaDB / MySQL: union_result — combines rows from UNION branches
  if (block["union_result"] !== undefined) {
    children.push(parseMariadbWrapper(block["union_result"], "Union Result", ids));
  }
  // MariaDB: buffer_result (SQL_BUFFER_RESULT hint)
  if (block["buffer_result"] !== undefined) {
    children.push(parseMariadbWrapper(block["buffer_result"], "Buffer Result", ids));
  }
  // MariaDB: window_functions_computation (window functions)
  if (block["window_functions_computation"] !== undefined) {
    children.push(
      parseMariadbWrapper(block["window_functions_computation"], "Window Functions", ids),
    );
  }
  // MariaDB: expression_cache (cached subquery results)
  if (block["expression_cache"] !== undefined) {
    children.push(parseMariadbWrapper(block["expression_cache"], "Expression Cache", ids));
  }
  // MariaDB: read_sorted_file (after filesort writes to disk)
  if (block["read_sorted_file"] !== undefined) {
    children.push(parseMariadbWrapper(block["read_sorted_file"], "Read Sorted File", ids));
  }
  // MariaDB: query_specifications inside union_result
  const specs = asArray(block["query_specifications"]);
  if (specs !== null) {
    for (const spec of specs) {
      children.push(parseMysqlQueryBlock(spec, ids));
    }
  }

  const indexCondition = table !== null ? asString(table["key"]) : null;

  // MariaDB ANALYZE data: r_total_time_ms, r_rows, r_loops.
  // Table objects may use r_table_time_ms + r_other_time_ms instead of
  // r_total_time_ms. Non-table nodes (query_block) carry these at block level.
  let actualTimeMs = asNumber(table?.["r_total_time_ms"]);
  if (actualTimeMs === null && table !== null) {
    const tableMs = asNumber(table["r_table_time_ms"]);
    const otherMs = asNumber(table["r_other_time_ms"]);
    if (tableMs !== null) {
      actualTimeMs = otherMs !== null ? tableMs + otherMs : tableMs;
    }
  }
  if (actualTimeMs === null) {
    actualTimeMs = asNumber(block["r_total_time_ms"]);
  }
  const actualRows = asNumber(table?.["r_rows"]) ?? asNumber(block["r_rows"]);
  const actualLoops = asLoopCount(table?.["r_loops"]) ?? asLoopCount(block["r_loops"]);

  return createExplainNode(id, {
    node_type: nodeType,
    relation,
    startup_cost: startupCost,
    total_cost: totalCost,
    plan_rows: planRows,
    actual_rows: actualRows,
    actual_time_ms: actualTimeMs,
    actual_loops: actualLoops,
    filter,
    index_condition: indexCondition,
    extra,
    children,
  });
}

// ---------------------------------------------------------------------------
// EXPLAIN ANALYZE text parser (MySQL 8.0.18+)
// ---------------------------------------------------------------------------

interface AnalyzeParsedLine {
  depth: number;
  node_type: string;
  relation: string | null;
  filter: string | null;
  index_condition: string | null;
  join_type: string | null;
  est_cost: number | null;
  est_rows: number | null;
  actual_time_ms: number | null;
  actual_rows: number | null;
  actual_loops: number | null;
}

/**
 * Parse MySQL EXPLAIN ANALYZE text output into a plan tree.
 *
 * Each line looks like:
 * `    -> Table scan on t1  (cost=1.25 rows=10) (actual time=0.045..0.145 rows=10 loops=1)`
 */
export function parseMysqlAnalyzeText(text: string, ids: NodeIdAllocator): ExplainNode {
  const parsedLines: AnalyzeParsedLine[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.replace(/\s+$/, "");
    if (trimmed === "") continue;

    // Count leading spaces for depth (4 spaces = 1 level)
    const leading = trimmed.length - trimmed.trimStart().length;
    const depth = Math.floor(leading / 4);

    const content = trimmed.trimStart();

    // Lines must start with "-> "
    if (!content.startsWith("-> ")) continue;
    const descRest = content.slice(3);

    // Description ends at double-space-paren "  ("
    const descEnd = descRest.indexOf("  (");
    const description = descEnd === -1 ? descRest : descRest.slice(0, descEnd);
    const metrics = descEnd === -1 ? "" : descRest.slice(descEnd);

    const [estCost, estRows] = parseAnalyzeEstimated(metrics);
    const [actualTimeMs, actualRows, actualLoops] = parseAnalyzeActual(metrics);
    const [nodeType, relation, filter, indexCondition, joinType] =
      mapAnalyzeDescription(description);

    parsedLines.push({
      depth,
      node_type: nodeType,
      relation,
      filter,
      index_condition: indexCondition,
      join_type: joinType,
      est_cost: estCost,
      est_rows: estRows,
      actual_time_ms: actualTimeMs,
      actual_rows: actualRows,
      actual_loops: actualLoops,
    });
  }

  if (parsedLines.length === 0) {
    return createExplainNode(ids.next(), { node_type: "Query" });
  }

  const [roots] = buildAnalyzeTree(parsedLines, 0, -1, ids);
  if (roots.length === 1) {
    return roots[0];
  }
  // Multiple roots — wrap in a Query node
  return createExplainNode(ids.next(), { node_type: "Query", children: roots });
}

/** Recursively build a tree from parsed lines using indentation depth. */
function buildAnalyzeTree(
  lines: AnalyzeParsedLine[],
  start: number,
  parentDepth: number,
  ids: NodeIdAllocator,
): [ExplainNode[], number] {
  const children: ExplainNode[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.depth <= parentDepth) break;

    const id = ids.next();
    const [grandchildren, nextI] = buildAnalyzeTree(lines, i + 1, line.depth, ids);

    children.push(
      createExplainNode(id, {
        node_type: line.node_type,
        relation: line.relation,
        total_cost: line.est_cost,
        plan_rows: line.est_rows,
        actual_rows: line.actual_rows,
        actual_time_ms: line.actual_time_ms,
        actual_loops: line.actual_loops,
        filter: line.filter,
        index_condition: line.index_condition,
        join_type: line.join_type,
        children: grandchildren,
      }),
    );

    i = nextI;
  }

  return [children, i];
}

/** Extract estimated cost and rows from the "(cost=X rows=Y)" section. */
function parseAnalyzeEstimated(s: string): [number | null, number | null] {
  const idx = s.indexOf("(cost=");
  if (idx === -1) return [null, null];
  const section = s.slice(idx);
  const end = section.indexOf(")");
  if (end === -1) return [null, null];
  const inner = section.slice(1, end); // "cost=X rows=Y"

  let cost: number | null = null;
  let rows: number | null = null;
  for (const part of inner.split(/\s+/)) {
    if (part.startsWith("cost=")) {
      cost = parseAnalyzeNumber(part.slice(5));
    } else if (part.startsWith("rows=")) {
      rows = parseAnalyzeNumber(part.slice(5));
    }
  }
  return [cost, rows];
}

/**
 * Extract actual time, rows, loops from the
 * "(actual time=X..Y rows=Z loops=W)" section.
 *
 * MySQL's tree-format `EXPLAIN ANALYZE` reports `time=first..last` as the
 * *per-loop* (per-iteration) timing, averaged across all `loops`. To obtain
 * the total wall-clock time spent in the node — which is what we display —
 * the per-loop end time must be multiplied by the loop count. This mirrors
 * how PostgreSQL's "Actual Total Time" relates to "Actual Loops". Without
 * this, nodes executed many times (e.g. an index lookup driven by a join)
 * report a tiny per-iteration figure instead of their real cost.
 */
export function parseAnalyzeActual(
  s: string,
): [number | null, number | null, number | null] {
  const idx = s.indexOf("(actual time=");
  if (idx === -1) return [null, null, null];
  const section = s.slice(idx);
  const end = section.indexOf(")");
  if (end === -1) return [null, null, null];
  const inner = section.slice(1, end); // "actual time=X..Y rows=Z loops=W"

  let perLoopTimeMs: number | null = null;
  let rows: number | null = null;
  let loops: number | null = null;

  for (const part of inner.split(/\s+/)) {
    if (part.startsWith("time=")) {
      // "time=first..last" — the end value is the per-loop time to read all rows
      const val = part.slice(5);
      const dotPos = val.indexOf("..");
      perLoopTimeMs = parseAnalyzeNumber(dotPos === -1 ? val : val.slice(dotPos + 2));
    } else if (part.startsWith("rows=")) {
      rows = parseAnalyzeNumber(part.slice(5));
    } else if (part.startsWith("loops=")) {
      loops = parseAnalyzeNumber(part.slice(6));
    }
  }

  // Scale the per-loop time to the total time across all iterations.
  const timeMs =
    perLoopTimeMs !== null && loops !== null ? perLoopTimeMs * loops : perLoopTimeMs;
  return [timeMs, rows, loops];
}

function parseAnalyzeNumber(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Map an EXPLAIN ANALYZE description to
 * (node_type, relation, filter, index_condition, join_type).
 */
function mapAnalyzeDescription(
  desc: string,
): [string, string | null, string | null, string | null, string | null] {
  const lower = desc.toLowerCase();
  const relation = extractOnRelation(desc);
  const indexCond = extractUsingIndex(desc);

  let nodeType: string;
  let filter: string | null = null;
  let joinType: string | null = null;

  if (lower.startsWith("table scan")) {
    nodeType = "Full Table Scan";
  } else if (lower.startsWith("covering index scan")) {
    nodeType = "Index Only Scan";
  } else if (lower.startsWith("index range scan") || lower.startsWith("range scan")) {
    nodeType = "Range Scan";
  } else if (lower.startsWith("index scan")) {
    nodeType = "Index Scan";
  } else if (lower.startsWith("single-row index lookup")) {
    nodeType = "Unique Index Lookup";
  } else if (lower.startsWith("index lookup") || lower.startsWith("multi-range index lookup")) {
    nodeType = "Index Lookup";
  } else if (lower.startsWith("constant row")) {
    nodeType = "Const Lookup";
  } else if (lower.startsWith("nested loop")) {
    nodeType = "Nested Loop";
    if (lower.includes("inner")) joinType = "Inner";
    else if (lower.includes("left")) joinType = "Left";
    else if (lower.includes("semijoin")) joinType = "Semi";
    else if (lower.includes("antijoin") || lower.includes("anti")) joinType = "Anti";
  } else if (lower.includes("hash join")) {
    nodeType = "Hash Join";
    joinType = lower.includes("left") ? "Left" : "Inner";
  } else if (lower.startsWith("filter:")) {
    nodeType = "Filter";
    const filt = desc.slice(7).trim();
    filter = filt === "" ? null : filt;
  } else if (lower.startsWith("sort:") || lower.startsWith("sort row")) {
    nodeType = "Sort";
  } else if (lower.startsWith("limit:") || lower.startsWith("limit ")) {
    nodeType = "Limit";
  } else if (lower.startsWith("group aggregate") || lower.startsWith("aggregate")) {
    nodeType = "Aggregate";
  } else if (lower.startsWith("temporary table") || lower.startsWith("materialize")) {
    nodeType = "Materialize";
  } else if (lower.startsWith("stream results") || lower.startsWith("stream")) {
    nodeType = "Stream";
  } else if (lower.startsWith("window aggregate") || lower.startsWith("window")) {
    nodeType = "Window";
  } else {
    nodeType = desc;
  }

  return [nodeType, relation, filter, indexCond, joinType];
}

/** Extract table/relation name from the "... on <table> ..." pattern. */
function extractOnRelation(desc: string): string | null {
  const pos = desc.indexOf(" on ");
  if (pos === -1) return null;
  const after = desc.slice(pos + 4);
  const endMatch = after.search(/[ (]/);
  const name = (endMatch === -1 ? after : after.slice(0, endMatch)).trim();
  return name === "" ? null : name;
}

/** Extract index name from the "... using <index> ..." pattern. */
function extractUsingIndex(desc: string): string | null {
  const pos = desc.toLowerCase().indexOf(" using ");
  if (pos === -1) return null;
  const after = desc.slice(pos + 7);
  const endMatch = after.search(/[ (]/);
  const name = (endMatch === -1 ? after : after.slice(0, endMatch)).trim();
  return name === "" ? null : name;
}

// ---------------------------------------------------------------------------
// Tabular EXPLAIN rows (all MySQL / MariaDB versions)
// ---------------------------------------------------------------------------

/**
 * One decoded row of tabular `EXPLAIN` output, as the host serialises it.
 *
 * The host owns the wire decoding (column lookup, VARBINARY vs VARCHAR); this
 * shape is the boundary between the driver and the parser.
 */
export interface MysqlTabularRow {
  select_type: string;
  table: string | null;
  access_type: string | null;
  possible_keys: string | null;
  key: string | null;
  rows: number | null;
  filtered: number | null;
  extra: string | null;
}

/**
 * Build a plan from tabular `EXPLAIN` rows (MySQL/MariaDB without
 * FORMAT=JSON). The flat rows become children of a synthetic `Query` root.
 */
export function parseMysqlTabularRows(rows: MysqlTabularRow[]): ExplainPlan {
  const ids = new NodeIdAllocator();
  const rootId = ids.next();
  const rawLines: string[] = [];
  const children: ExplainNode[] = [];

  for (const row of rows) {
    const accessType = row.access_type ?? "";
    const nodeType =
      accessType === "" ? "Unknown" : (MYSQL_ACCESS_TYPES[accessType] ?? accessType);

    rawLines.push(
      [
        row.select_type,
        row.table ?? "",
        accessType,
        row.key ?? "-",
        row.rows ?? 0,
        row.extra ?? "",
      ].join("\t"),
    );

    const extra: JsonObject = { select_type: row.select_type };
    if (row.possible_keys !== null) extra["possible_keys"] = row.possible_keys;
    if (row.filtered !== null) extra["filtered"] = row.filtered;
    if (row.extra !== null) extra["extra"] = row.extra;

    children.push(
      createExplainNode(ids.next(), {
        node_type: nodeType,
        relation: row.table === null || row.table === "" ? null : row.table,
        plan_rows: row.rows,
        filter: row.extra,
        index_condition: row.key,
        extra,
      }),
    );
  }

  const root = createExplainNode(rootId, { node_type: "Query", children });

  return {
    root,
    planning_time_ms: null,
    execution_time_ms: null,
    original_query: "",
    driver: "mysql",
    has_analyze_data: false,
    raw_output: rawLines.join("\n"),
  };
}
