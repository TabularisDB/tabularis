/**
 * Headless EXPLAIN plan parsing and analysis.
 *
 * This entry point has **no runtime dependencies** — no React, no graph library,
 * no host. The parsers turn raw EXPLAIN output (text, JSON, or decoded rows)
 * into an `ExplainPlan`; everything else derives something from that plan.
 *
 * Rendering lives in `@tabularis/explain/react`; the ReactFlow adapter lives in
 * `@tabularis/explain/flow`.
 */

export type { ExplainNode, ExplainPlan } from "./types";

export type {
  ExplainEngine,
  ExplainSourceFormat,
  ExplainSourceParser,
} from "./parsers/source";
export {
  detectFormat,
  detectFormatFor,
  explainEngineFromDriverName,
  parseExplain,
  parseExplainFor,
  withSourceLabel,
} from "./parsers/source";

export { parsePostgresJson, parsePostgresText } from "./parsers/postgres";
export type { MysqlTabularRow } from "./parsers/mysql";
export {
  parseMysqlJson,
  parseMysqlTabularRows,
  parseMysqlText,
} from "./parsers/mysql";
export type { SqliteEqpRow } from "./parsers/sqlite";
export { buildSqliteTree, parseSqliteEqpRows } from "./parsers/sqlite";
export { NodeIdAllocator, hasAnalyzeDataRecursive } from "./parsers/node";

export type {
  ExplainQueryOutput,
  RawExplainFormat,
  RawExplainOutput,
} from "./raw";
export { parseRawExplain, resolveExplainOutput } from "./raw";

export type {
  ExplainMetrics,
  ExplainNodeMetrics,
  ExplainMetricKind,
} from "./metrics";
export {
  EXPLAIN_METRIC_KINDS,
  computeExplainMetrics,
  getNodeMetrics,
  getMetricValue,
  getMetricMax,
  isMetricAvailable,
  getAvailableMetricKinds,
  getDefaultMetricKind,
} from "./metrics";

export type {
  ExplainDiagnostic,
  ExplainDiagnosticKind,
  ExplainDiagnosticSeverity,
} from "./diagnostics";
export {
  EXPLAIN_DIAGNOSTIC_THRESHOLDS,
  getNodeDiagnostics,
  getPlanDiagnostics,
  getWorstSeverity,
  countDiagnosticsBySeverity,
} from "./diagnostics";

export type {
  ExplainPlanStats,
  ExplainNodeTypeStat,
  ExplainRelationStat,
  ExplainIndexStat,
} from "./stats";
export { getExplainPlanStats } from "./stats";

export type {
  NodeCostStyle,
  ExplainMetricNode,
  ExplainPlanSummary,
} from "./plan";
export {
  getNodeCostStyle,
  getHeatBarClass,
  formatCost,
  formatTime,
  formatRows,
  formatRatio,
  getMaxCost,
  getMaxTime,
  flattenExplainNodes,
  findExplainNode,
  getRowEstimateRatio,
  getExplainPlanSummary,
  getExplainDriverLegend,
} from "./plan";
