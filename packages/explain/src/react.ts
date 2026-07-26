/**
 * React views over a parsed `ExplainPlan`.
 *
 * Every component is fed a plan and calls back on selection — none of them
 * fetches, runs or imports anything host-specific. Requirements on the host:
 *
 * - Tailwind, with the same colour tokens the desktop app uses;
 * - an initialised `react-i18next` instance providing the
 *   `editor.visualExplain.*` key namespace;
 * - `@xyflow/react`'s stylesheet, if `ExplainGraph` is used.
 */

export { ExplainGraph } from "./components/ExplainGraph";
export { ExplainTableView } from "./components/ExplainTableView";
export { ExplainDiagramView } from "./components/ExplainDiagramView";
export { ExplainStatsView } from "./components/ExplainStatsView";
export { ExplainNodeDetails } from "./components/ExplainNodeDetails";
export { ExplainOverviewBar } from "./components/ExplainOverviewBar";
export { ExplainSummaryBar } from "./components/ExplainSummaryBar";
export type { ExplainViewMode } from "./components/ExplainSummaryBar";
export {
  ExplainDiagnosticChips,
  ExplainDiagnosticList,
} from "./components/ExplainDiagnosticChips";
export { ExplainPlanNodeComponent } from "./components/ExplainPlanNode";
export type {
  ExplainPlanNodeData,
  ExplainPlanNodeType,
} from "./components/ExplainPlanNode";
