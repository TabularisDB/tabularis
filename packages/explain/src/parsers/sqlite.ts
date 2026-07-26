/**
 * SQLite plan parsers.
 *
 * SQLite's `EXPLAIN QUERY PLAN` returns `(id, parent, detail)` triples. The
 * host decodes those rows; everything below turns them into a plan tree and
 * reads the `detail` strings, with no driver in sight.
 */

import type { ExplainNode, ExplainPlan } from "../types";
import { NodeIdAllocator, createExplainNode } from "./node";

/** One decoded `EXPLAIN QUERY PLAN` row, as the host serialises it. */
export interface SqliteEqpRow {
  id: number;
  parent: number;
  detail: string;
}

export function buildSqliteTree(
  entries: SqliteEqpRow[],
  parentId: number,
  ids: NodeIdAllocator,
): ExplainNode {
  // Find the first entry with the given parent_id to use as the root node
  const rootEntry = entries.find((entry) =>
    parentId === 0 ? entry.parent === 0 && entry.id === 0 : entry.id === parentId,
  );

  const [nodeType, relation, indexCondition] =
    rootEntry !== undefined
      ? parseSqliteDetail(rootEntry.detail)
      : ["Query Plan", null, null];

  const id = ids.next();

  // Find children: entries whose parent matches the root entry's id
  const rootId = rootEntry?.id ?? 0;
  const childIds = entries
    .filter((entry) => entry.parent === rootId && entry.id !== rootId)
    .map((entry) => entry.id);

  const children = childIds.map((childId) => {
    const childEntry = entries.find((entry) => entry.id === childId);
    const [ct, cr, ci] =
      childEntry !== undefined
        ? parseSqliteDetail(childEntry.detail)
        : ["Unknown", null, null];

    const childNodeId = ids.next();

    // Recursively find grandchildren
    const grandchildren = entries
      .filter((entry) => entry.parent === childId)
      .map((entry) => buildSqliteTree(entries, entry.id, ids));

    return createExplainNode(childNodeId, {
      node_type: ct,
      relation: cr,
      index_condition: ci,
      children: grandchildren,
    });
  });

  return createExplainNode(id, {
    node_type: nodeType,
    relation,
    index_condition: indexCondition,
    children,
  });
}

/**
 * Build a full plan from decoded `EXPLAIN QUERY PLAN` rows, reconstructing
 * the familiar `id|parent|detail` raw text alongside the tree.
 */
export function parseSqliteEqpRows(entries: SqliteEqpRow[]): ExplainPlan {
  if (entries.length === 0) {
    throw new Error("EXPLAIN QUERY PLAN returned no output");
  }

  const ids = new NodeIdAllocator();
  const root = buildSqliteTree(entries, 0, ids);
  const rawOutput = entries
    .map((entry) => `${entry.id}|${entry.parent}|${entry.detail}`)
    .join("\n");

  return {
    root,
    planning_time_ms: null,
    execution_time_ms: null,
    original_query: "",
    driver: "sqlite",
    has_analyze_data: false,
    raw_output: rawOutput,
  };
}

export function parseSqliteDetail(
  detail: string,
): [string, string | null, string | null] {
  const detailUpper = detail.toUpperCase();

  if (detailUpper.startsWith("SCAN")) {
    // "SCAN t1" or "SCAN t1 USING ..."
    const parts = detail.split(" ");
    const relation = parts[1] ?? null;
    let index: string | null = null;
    if (detailUpper.includes("USING INDEX")) {
      index = detail.slice(detail.indexOf("USING INDEX") + 12).trim();
    } else if (detailUpper.includes("USING COVERING INDEX")) {
      index = detail.slice(detail.indexOf("USING COVERING INDEX") + 21).trim();
    }
    return ["Scan", relation, index];
  }
  if (detailUpper.startsWith("SEARCH")) {
    const parts = detail.split(" ");
    const relation = parts[1] ?? null;
    let index: string | null = null;
    if (detailUpper.includes("USING INDEX")) {
      index = detail.slice(detail.indexOf("USING INDEX") + 12).trim();
    } else if (detailUpper.includes("USING INTEGER PRIMARY KEY")) {
      index = "PRIMARY KEY";
    } else if (detailUpper.includes("USING COVERING INDEX")) {
      index = detail.slice(detail.indexOf("USING COVERING INDEX") + 21).trim();
    }
    return ["Search", relation, index];
  }
  if (detailUpper.includes("TEMP B-TREE")) {
    return ["Sort", null, null];
  }
  if (detailUpper.startsWith("CO-ROUTINE")) {
    return ["Co-routine", null, null];
  }
  if (detailUpper.startsWith("COMPOUND SUBQUERIES")) {
    return ["Compound Subquery", null, null];
  }
  if (detailUpper.startsWith("MATERIALIZE")) {
    return ["Materialize", null, null];
  }
  return [detail, null, null];
}
