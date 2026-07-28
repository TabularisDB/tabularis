/**
 * Shared building blocks for every plan parser.
 *
 * Pure value -> `ExplainNode` helpers: no host, no driver, no React.
 */

import type { ExplainNode } from "../types";

/** Hands out sequential `node_N` ids so every node in a plan is unique. */
export class NodeIdAllocator {
  private counter = 0;

  next(): string {
    const id = `node_${this.counter}`;
    this.counter += 1;
    return id;
  }
}

/**
 * Build an `ExplainNode`, defaulting every optional field to `null` so parsers
 * only spell out what the source format actually carries.
 */
export function createExplainNode(
  id: string,
  overrides: Partial<Omit<ExplainNode, "id">> = {},
): ExplainNode {
  return {
    id,
    node_type: "Unknown",
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
    ...overrides,
  };
}

/** Check recursively whether any node in the tree carries actual ANALYZE data. */
export function hasAnalyzeDataRecursive(node: ExplainNode): boolean {
  if (node.actual_rows !== null || node.actual_time_ms !== null) {
    return true;
  }
  return node.children.some(hasAnalyzeDataRecursive);
}

/** A parsed JSON object, navigated field by field. */
export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a numeric field that some engines serialise as a string ("12.34"). */
export function asLooseNumber(value: unknown): number | null {
  const direct = asNumber(value);
  if (direct !== null) return direct;
  const text = asString(value);
  if (text === null || text.trim() === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Read a loop counter: an integer, truncating engines that emit floats. */
export function asLoopCount(value: unknown): number | null {
  const num = asNumber(value);
  return num === null ? null : Math.trunc(num);
}
