# @tabularis/explain

Analyse and visualise a database EXPLAIN plan.

Takes a plan that has *already* been produced and derives everything from it:
per-node exclusive metrics, diagnostics, statistics, and React views. It never
connects to a database, builds an `EXPLAIN` statement, or runs a query.

## Entry points

| Import | Contains | Runtime deps |
|---|---|---|
| `@tabularis/explain` | plan types, metrics, diagnostics, stats, formatters, tree helpers | **none** |
| `@tabularis/explain/react` | the views: graph, table, diagram, stats, node details, bars | react, react-i18next, @xyflow/react, dagre, clsx, lucide-react |
| `@tabularis/explain/flow` | ReactFlow node/edge adapter + dagre layout | @xyflow/react, dagre |

The core entry point has **no runtime dependencies at all**, so plan analysis can
run anywhere — a browser, a worker, a Node script, a test.

```ts
import {
  computeExplainMetrics,
  getPlanDiagnostics,
  getExplainPlanSummary,
} from "@tabularis/explain";

const metrics = computeExplainMetrics(plan);
const diagnostics = getPlanDiagnostics(plan, metrics);
const summary = getExplainPlanSummary(plan, metrics);
```

```tsx
import { ExplainGraph, ExplainTableView } from "@tabularis/explain/react";

<ExplainGraph
  plan={plan}
  metrics={metrics}
  diagnostics={diagnostics}
  selectedNodeId={selectedNodeId}
  onSelectNode={setSelectedNodeId}
/>;
```

## Where a plan comes from

This package never runs a query — it turns *already-produced* EXPLAIN output
into an `ExplainPlan` and analyses it. The parsers cover Postgres
`EXPLAIN (FORMAT JSON)` and text output, MySQL/MariaDB `FORMAT=JSON`,
`EXPLAIN ANALYZE` / `ANALYZE FORMAT=TEXT` trees and decoded tabular rows, and
SQLite `EXPLAIN QUERY PLAN` rows:

```ts
import { parseExplain, parseExplainFor, parseRawExplain } from "@tabularis/explain";

// Sniff the format of a pasted blob or an uploaded file:
const plan = parseExplain(raw);

// Or name the engine when the caller knows it:
const hinted = parseExplainFor(raw, "mysql");

// Or parse the raw payload a host driver handed over:
const fromDriver = parseRawExplain({ engine, format, payload, original_query });
```

A host obtains the bytes however it likes — a driver, a pasted textarea, an
uploaded file — and hands them over untouched. Drivers for engines these
parsers do not know (plugin drivers) supply a fully-parsed `ExplainPlan`
instead; both shapes flow through `resolveExplainOutput`.

## Host requirements for the React entry point

The views are presentational but not self-contained. A host must provide:

- **Tailwind**, with the same colour tokens the desktop app uses — components
  emit utility class names rather than scoped CSS;
- **an initialised `react-i18next` instance** exposing the
  `editor.visualExplain.*` key namespace. The keys deliberately stay with the
  host's translation catalogue rather than being bundled here;
- **`@xyflow/react`'s stylesheet**, if `ExplainGraph` is used.

## Deliberately not included

- Running `EXPLAIN`, or deciding whether a statement can be explained
  (`isExplainableQuery` / `isDataModifyingQuery` are host SQL concerns).
- Any Tauri, IPC or transport call.
- The AI plan explanation, which is a host feature backed by a host-configured
  provider.
- The raw-output tab, which the desktop app renders with Monaco and its own
  theme system.

The last two are why the desktop app keeps its own `VisualExplainView`
composition: it wires those host pieces around the components exported here.

## Development

```bash
pnpm --filter @tabularis/explain typecheck
pnpm --filter @tabularis/explain build     # tsup → dist, for publishing
pnpm vitest run packages/explain           # tests run from the repo root
```

Workspace consumers resolve the entry points straight to TypeScript source, so
no build step is needed during development; `publishConfig` swaps in `dist` when
the package is published.
