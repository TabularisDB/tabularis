import type { ExplainNode, ExplainPlan } from "../types/explain";
import type { ExplainMetrics, ExplainNodeMetrics } from "./explainMetrics";
import { flattenExplainNodes, formatRatio, formatRows } from "./explainPlan";

export type ExplainDiagnosticKind =
  | "hotspot"
  | "over-estimate"
  | "under-estimate"
  | "disk-sort"
  | "filter-loss"
  | "large-seq-scan"
  | "heap-fetches"
  | "workers-underused"
  | "high-loops"
  | "cache-miss"
  | "never-executed";

export type ExplainDiagnosticSeverity = "info" | "warning" | "critical";

export interface ExplainDiagnostic {
  kind: ExplainDiagnosticKind;
  severity: ExplainDiagnosticSeverity;
  /** i18n key for the short chip label. */
  labelKey: string;
  /** i18n key for the one-line explanation shown in the node details. */
  descriptionKey: string;
  /** Pre-formatted figure shown next to the label, when the check has one. */
  value?: string;
}

/**
 * Thresholds every check is calibrated against. Exported so tests pin the
 * boundaries rather than duplicating the numbers.
 */
export const EXPLAIN_DIAGNOSTIC_THRESHOLDS = {
  /** Share of total plan time above which a node is called a hotspot. */
  hotspotTimeShare: 0.25,
  /** Nodes faster than this never count as a hotspot, however large the share. */
  hotspotMinTimeMs: 1,
  /** Row estimate off by this factor is a warning. */
  estimateWarnFactor: 4,
  /** Row estimate off by this factor is critical. */
  estimateCriticalFactor: 10,
  /** Estimate checks are skipped below this many actual rows, to cut noise. */
  estimateMinRows: 10,
  /** Fraction of scanned rows dropped by a filter that counts as wasted work. */
  filterLossRatio: 0.9,
  /** Filter checks are skipped below this many discarded rows. */
  filterLossMinRows: 1000,
  /** Sequential scans below this many rows are not reported. */
  seqScanMinRows: 10_000,
  /** Heap fetches above this count suggest the visibility map is stale. */
  heapFetchesMinCount: 1000,
  /** Loop count above which repeated execution is worth pointing out. */
  highLoopsMinCount: 1000,
  /** Fraction of buffer accesses that missed shared buffers. */
  cacheMissRatio: 0.5,
  /** Cache checks are skipped below this many blocks read from disk. */
  cacheMissMinBlocks: 1000,
} as const;

const SEVERITY_RANK: Record<ExplainDiagnosticSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function extraString(node: ExplainNode, key: string): string | null {
  const value = node.extra[key];
  return typeof value === "string" ? value : null;
}

function extraNumber(node: ExplainNode, key: string): number | null {
  const value = node.extra[key];
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isSequentialScan(node: ExplainNode): boolean {
  const nodeType = node.node_type.toLowerCase();
  const accessType = extraString(node, "access_type")?.toLowerCase() ?? "";

  return (
    nodeType.includes("seq scan") ||
    nodeType.includes("table scan") ||
    nodeType.includes("full scan") ||
    accessType === "all"
  );
}

/**
 * Whether the node sorted or hashed through disk rather than memory. Postgres
 * reports this through `Sort Method` / `Sort Space Type`, MySQL through the
 * free-form extra text.
 */
function usesDiskWorkspace(node: ExplainNode): boolean {
  const sortMethod = extraString(node, "Sort Method")?.toLowerCase() ?? "";
  const sortSpace = extraString(node, "Sort Space Type")?.toLowerCase() ?? "";

  if (sortMethod.includes("disk") || sortSpace === "disk") {
    return true;
  }

  return (extraNumber(node, "Temp Written Blocks") ?? 0) > 0;
}

function estimateDiagnostic(
  node: ExplainNode,
): ExplainDiagnostic | null {
  const { estimateMinRows, estimateWarnFactor, estimateCriticalFactor } =
    EXPLAIN_DIAGNOSTIC_THRESHOLDS;

  if (
    node.plan_rows == null ||
    node.actual_rows == null ||
    node.plan_rows <= 0 ||
    node.actual_rows < estimateMinRows
  ) {
    return null;
  }

  const ratio = node.actual_rows / node.plan_rows;
  const factor = ratio >= 1 ? ratio : 1 / ratio;

  if (factor < estimateWarnFactor) {
    return null;
  }

  const severity: ExplainDiagnosticSeverity =
    factor >= estimateCriticalFactor ? "critical" : "warning";

  return ratio >= 1
    ? {
        kind: "over-estimate",
        severity,
        labelKey: "editor.visualExplain.diagnostics.overEstimate",
        descriptionKey: "editor.visualExplain.diagnostics.overEstimateHint",
        value: formatRatio(factor),
      }
    : {
        kind: "under-estimate",
        severity,
        labelKey: "editor.visualExplain.diagnostics.underEstimate",
        descriptionKey: "editor.visualExplain.diagnostics.underEstimateHint",
        value: formatRatio(factor),
      };
}

/**
 * Checks that apply to a single node. `metrics` is optional so a node can be
 * inspected without a full plan walk; the hotspot check is skipped without it.
 */
export function getNodeDiagnostics(
  node: ExplainNode,
  metrics?: ExplainNodeMetrics | null,
): ExplainDiagnostic[] {
  const t = EXPLAIN_DIAGNOSTIC_THRESHOLDS;
  const diagnostics: ExplainDiagnostic[] = [];

  if (metrics?.neverExecuted) {
    diagnostics.push({
      kind: "never-executed",
      severity: "info",
      labelKey: "editor.visualExplain.diagnostics.neverExecuted",
      descriptionKey: "editor.visualExplain.diagnostics.neverExecutedHint",
    });

    // Nothing ran, so no measured check below can say anything useful.
    return diagnostics;
  }

  if (
    metrics?.timeShare != null &&
    metrics.timeShare >= t.hotspotTimeShare &&
    (metrics.exclusiveTimeMs ?? 0) >= t.hotspotMinTimeMs
  ) {
    diagnostics.push({
      kind: "hotspot",
      severity: "critical",
      labelKey: "editor.visualExplain.diagnostics.hotspot",
      descriptionKey: "editor.visualExplain.diagnostics.hotspotHint",
      value: `${Math.round(metrics.timeShare * 100)}%`,
    });
  }

  const estimate = estimateDiagnostic(node);
  if (estimate) {
    diagnostics.push(estimate);
  }

  if (usesDiskWorkspace(node)) {
    diagnostics.push({
      kind: "disk-sort",
      severity: "warning",
      labelKey: "editor.visualExplain.diagnostics.diskSort",
      descriptionKey: "editor.visualExplain.diagnostics.diskSortHint",
      value: extraString(node, "Sort Method") ?? undefined,
    });
  }

  const rowsRemoved = extraNumber(node, "Rows Removed by Filter");
  if (rowsRemoved != null && rowsRemoved >= t.filterLossMinRows) {
    const kept = node.actual_rows ?? 0;
    const scanned = kept + rowsRemoved;
    if (scanned > 0 && rowsRemoved / scanned >= t.filterLossRatio) {
      diagnostics.push({
        kind: "filter-loss",
        severity: "warning",
        labelKey: "editor.visualExplain.diagnostics.filterLoss",
        descriptionKey: "editor.visualExplain.diagnostics.filterLossHint",
        value: formatRows(rowsRemoved),
      });
    }
  }

  if (isSequentialScan(node)) {
    const rows = node.actual_rows ?? node.plan_rows;
    if (rows != null && rows >= t.seqScanMinRows) {
      diagnostics.push({
        kind: "large-seq-scan",
        severity: "warning",
        labelKey: "editor.visualExplain.diagnostics.largeSeqScan",
        descriptionKey: "editor.visualExplain.diagnostics.largeSeqScanHint",
        value: formatRows(rows),
      });
    }
  }

  const heapFetches = extraNumber(node, "Heap Fetches");
  if (heapFetches != null && heapFetches >= t.heapFetchesMinCount) {
    diagnostics.push({
      kind: "heap-fetches",
      severity: "warning",
      labelKey: "editor.visualExplain.diagnostics.heapFetches",
      descriptionKey: "editor.visualExplain.diagnostics.heapFetchesHint",
      value: formatRows(heapFetches),
    });
  }

  const workersPlanned = extraNumber(node, "Workers Planned");
  const workersLaunched = extraNumber(node, "Workers Launched");
  if (
    workersPlanned != null &&
    workersLaunched != null &&
    workersLaunched < workersPlanned
  ) {
    diagnostics.push({
      kind: "workers-underused",
      severity: "warning",
      labelKey: "editor.visualExplain.diagnostics.workersUnderused",
      descriptionKey: "editor.visualExplain.diagnostics.workersUnderusedHint",
      value: `${workersLaunched}/${workersPlanned}`,
    });
  }

  if (node.actual_loops != null && node.actual_loops >= t.highLoopsMinCount) {
    diagnostics.push({
      kind: "high-loops",
      severity: "info",
      labelKey: "editor.visualExplain.diagnostics.highLoops",
      descriptionKey: "editor.visualExplain.diagnostics.highLoopsHint",
      value: formatRows(node.actual_loops),
    });
  }

  if (
    node.buffers_read != null &&
    node.buffers_read >= t.cacheMissMinBlocks &&
    node.buffers_read / (node.buffers_read + (node.buffers_hit ?? 0)) >=
      t.cacheMissRatio
  ) {
    diagnostics.push({
      kind: "cache-miss",
      severity: "info",
      labelKey: "editor.visualExplain.diagnostics.cacheMiss",
      descriptionKey: "editor.visualExplain.diagnostics.cacheMissHint",
      value: formatRows(node.buffers_read),
    });
  }

  return diagnostics.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

/** Diagnostics for every node in the plan, keyed by node id. */
export function getPlanDiagnostics(
  plan: ExplainPlan,
  metrics: ExplainMetrics,
): Map<string, ExplainDiagnostic[]> {
  const result = new Map<string, ExplainDiagnostic[]>();

  for (const node of flattenExplainNodes(plan.root)) {
    const diagnostics = getNodeDiagnostics(node, metrics.byId.get(node.id));
    if (diagnostics.length > 0) {
      result.set(node.id, diagnostics);
    }
  }

  return result;
}

/** Highest severity in a list, or `null` when the list is empty. */
export function getWorstSeverity(
  diagnostics: ExplainDiagnostic[],
): ExplainDiagnosticSeverity | null {
  let worst: ExplainDiagnosticSeverity | null = null;

  for (const diagnostic of diagnostics) {
    if (worst == null || SEVERITY_RANK[diagnostic.severity] < SEVERITY_RANK[worst]) {
      worst = diagnostic.severity;
    }
  }

  return worst;
}

/** How many diagnostics of each severity the whole plan produced. */
export function countDiagnosticsBySeverity(
  diagnostics: Map<string, ExplainDiagnostic[]>,
): Record<ExplainDiagnosticSeverity, number> {
  const counts: Record<ExplainDiagnosticSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };

  for (const list of diagnostics.values()) {
    for (const diagnostic of list) {
      counts[diagnostic.severity] += 1;
    }
  }

  return counts;
}
